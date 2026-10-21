import type { Change } from '../sections/types'
import { Icon, plural } from './parts'
import type { PlanView } from './types'

const OP: Record<string, { sign: string; tone: string; label: string }> = {
  create: { sign: '+', tone: 'success', label: 'create' },
  update: { sign: '~', tone: 'warning', label: 'update' },
  delete: { sign: '−', tone: 'danger', label: 'delete' },
  noop: { sign: '=', tone: 'neutral', label: 'no change' },
}

const show = (v: unknown): string => {
  if (v === undefined) return '—'
  if (typeof v === 'string') return v === '' ? '""' : v
  return JSON.stringify(v, null, 2)
}

const Val = ({ value, side }: { value: unknown; side: 'before' | 'after' }) => {
  const text = show(value)
  return text.includes('\n') || text.length > 80 ? (
    <pre class="t-code-pre diff-val" data-side={side} safe>
      {text}
    </pre>
  ) : (
    <code class="diff-val" data-side={side} safe>
      {text}
    </code>
  )
}

/** Pending changes as a compact table: op, section, target, before → after; destructive rows marked. */
export const ChangeTable = ({ changes, empty = 'No changes: the repo already matches.' }: { changes: Change[]; empty?: string }) =>
  changes.length ? (
    <div class="t-table-wrap">
      <table class="t-table diff-table" data-density="compact" aria-label="Changes">
        <thead>
          <tr>
            <th class="t-col-icon" aria-label="Operation"></th>
            <th class="t-col-shrink">Section</th>
            <th>Target</th>
            <th>Before</th>
            <th>After</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => {
            const op = OP[c.op] ?? OP.update!
            return (
              <tr data-tone={c.destructive ? 'danger' : undefined} data-op={c.op}>
                <td class="t-col-icon">
                  <span class="t-badge diff-op" data-tone={op.tone} data-tip={op.label} aria-label={op.label}>
                    {op.sign}
                  </span>
                </td>
                <td class="t-col-shrink" safe>
                  {c.section}
                </td>
                <td>
                  <span class="t-mono" safe>
                    {c.target}
                  </span>
                  {c.destructive ? (
                    <span class="t-badge" data-tone="danger" data-size="xs">
                      destructive
                    </span>
                  ) : null}
                  {c.reason ? (
                    <div class="t-small t-muted" safe>
                      {c.reason}
                    </div>
                  ) : null}
                </td>
                <td>{c.op === 'create' ? <span class="t-muted">—</span> : <Val value={c.before} side="before" />}</td>
                <td>{c.op === 'delete' ? <span class="t-muted">—</span> : <Val value={c.after} side="after" />}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  ) : (
    <p class="t-muted diff-empty" safe>
      {empty}
    </p>
  )

/** A plan: summary line, skipped sections with their reason, and the change table. */
export const PlanDiff = ({ plan }: { plan: PlanView }) => (
  <div class="t-stack plan-diff" data-gap="2" data-plan={plan.id ?? ''} data-destructive={String(plan.destructive)} data-changes={String(plan.changes.length)}>
    <div class="t-cluster" data-gap="2" data-align="center">
      <span class="t-badge" data-tone={plan.changes.length ? 'warning' : 'success'}>
        {plan.changes.length ? plural(plan.changes.length, 'change') : 'in sync'}
      </span>
      {plan.destructive ? (
        <span class="t-badge" data-tone="danger">
          {`${String(plan.destructive)} destructive`}
        </span>
      ) : null}
      {plan.skipped.length ? (
        <span class="t-badge" data-tone="neutral">
          {`${String(plan.skipped.length)} skipped`}
        </span>
      ) : null}
    </div>
    {plan.skipped.length ? (
      <ul class="t-plain-list t-small skipped-list">
        {plan.skipped.map((s) => (
          <li>
            <Icon id="bi-dash-circle" /> <b safe>{s.section}</b>
            {s.template ? <span class="t-muted" safe>{` (${s.template})`}</span> : null}: <span safe>{s.reason}</span>
          </li>
        ))}
      </ul>
    ) : null}
    <ChangeTable changes={plan.changes} />
  </div>
)

/** Redacted event diff `{before, after}` or `{changes}`, whatever the event stored. */
export const EventDiff = ({ diff }: { diff: unknown }) => {
  if (diff == null) return <p class="t-muted">This event stored no diff.</p>
  const d = diff as { changes?: Change[]; skipped?: unknown[]; before?: unknown; after?: unknown }
  if (Array.isArray(d.changes)) return <ChangeTable changes={d.changes} />
  if ('before' in d || 'after' in d)
    return (
      <div class="t-grid" data-cols="2" data-min="sm">
        <div class="t-stack" data-gap="1">
          <span class="t-label">Before</span>
          <pre class="t-code-pre" data-variant="json" safe>
            {show(d.before)}
          </pre>
        </div>
        <div class="t-stack" data-gap="1">
          <span class="t-label">After</span>
          <pre class="t-code-pre" data-variant="json" safe>
            {show(d.after)}
          </pre>
        </div>
      </div>
    )
  return (
    <pre class="t-code-pre" data-variant="json" safe>
      {JSON.stringify(diff, null, 2)}
    </pre>
  )
}
