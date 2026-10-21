import { EventDialog, EventsTable } from './audit'
import { DiffDialog } from './repos'
import { DriftBadge, Empty, Icon, PageHeader, RelTime, VisibilityBadge } from './parts'
import type { EventView, Lookups, RepoView, SetView, Value, ValueField, Values } from './types'

export type AssignedSetView = { set: string; values: Values; info?: SetView; fields: ValueField[] }

export type RepoData = {
  repo: RepoView & { events: EventView[] }
  assigned: AssignedSetView[]
  sets: SetView[]
  lookups: Lookups
  lookupError?: string
}

const asText = (v: Value | undefined) => (v === undefined ? '' : String(v))

/** One control for one `${{ values.key }}` placeholder, typed by what the template expects there. */
export const ValueControl = ({ field, value, fallback, lookups, id }: { field: ValueField; value: Value | undefined; fallback: Value | undefined; lookups: Lookups; id: string }) => {
  const common = { 'data-value-key': field.key, 'data-value-kind': field.kind, 'data-present': value === undefined ? undefined : '1' }
  if (field.kind === 'boolean') {
    const on = value === undefined ? fallback === true || fallback === 'true' : value === true || value === 'true'
    return (
      <label class="t-check" data-variant="switch">
        <input class="t-check-input" type="checkbox" role="switch" id={id} checked={on} {...common} />
        <span class="t-check-label">{on ? 'on' : 'off'}</span>
      </label>
    )
  }
  if (field.kind === 'enum' && field.options?.length) {
    return (
      <select class="t-select" data-size="sm" id={id} {...common}>
        <option value="">{fallback === undefined ? 'Not set' : `Set default (${String(fallback)})`}</option>
        {field.options.map((o) => (
          <option value={o} selected={asText(value) === o} safe>
            {o}
          </option>
        ))}
      </select>
    )
  }
  if (field.lookup) {
    const known = lookups[field.lookup]
    const current = asText(value)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const options = [...new Set([...known, ...current])].sort((a, b) => a.localeCompare(b))
    if (field.multi) {
      return (
        <fieldset class="t-check-group value-multi" id={id} {...common} data-value-multi>
          <legend class="t-visually-hidden" safe>
            {field.key}
          </legend>
          {options.length ? (
            options.map((o) => (
              <label class="t-check">
                <input class="t-check-input" type="checkbox" value={o} checked={current.includes(o)} />
                <span class="t-check-label">
                  <span safe>{o}</span>
                  {known.includes(o) ? null : <span class="t-check-desc">not seen on this repo</span>}
                </span>
              </label>
            ))
          ) : (
            <p class="t-small t-muted" safe>
              {`No ${field.lookup} found on this repo yet.`}
            </p>
          )}
        </fieldset>
      )
    }
    return (
      <div class="t-stack" data-gap="1">
        <select class="t-select" data-size="sm" id={id} {...common} data-other={`${id}-other`}>
          <option value="">{fallback === undefined ? 'Not set' : `Set default (${String(fallback)})`}</option>
          {options.map((o) => (
            <option value={o} selected={current[0] === o} safe>
              {o}
            </option>
          ))}
          <option value="__other">Other…</option>
        </select>
        <input class="t-input" data-size="sm" id={`${id}-other`} aria-label={`Other ${field.key}`} hidden />
      </div>
    )
  }
  if (field.kind === 'number') {
    return <input class="t-input" data-size="sm" type="number" id={id} value={asText(value)} placeholder={fallback === undefined ? '' : String(fallback)} {...common} />
  }
  if (field.kind === 'text') {
    return (
      <textarea class="t-textarea t-mono" rows="4" id={id} placeholder={fallback === undefined ? '' : String(fallback)} {...common} safe>
        {asText(value)}
      </textarea>
    )
  }
  return <input class="t-input" data-size="sm" id={id} value={asText(value)} placeholder={fallback === undefined ? '' : String(fallback)} {...common} />
}

const AssignedSet = ({ a, index, total, lookups }: { a: AssignedSetView; index: number; total: number; lookups: Lookups }) => (
  <div class="t-card assigned-set" data-set={a.set}>
    <div class="t-card-header">
      <h3 class="t-card-title">
        <Icon id="bi-collection" />
        <a href={`/sets/${a.set}`} safe>
          {a.set}
        </a>
      </h3>
      <div class="t-card-tools t-cluster" data-gap="1">
        <button class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" data-action="set-up" aria-label={`Move ${a.set} up`} data-tip="Move up" disabled={index === 0}>
          <Icon id="bi-arrow-up" />
        </button>
        <button class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" data-action="set-down" aria-label={`Move ${a.set} down`} data-tip="Move down" disabled={index === total - 1}>
          <Icon id="bi-arrow-down" />
        </button>
        <button class="t-btn" data-size="xs" data-variant="ghost" data-tone="danger" data-icon="only" data-action="set-remove" aria-label={`Remove ${a.set}`} data-tip="Remove from this repo">
          <Icon id="bi-x-lg" />
        </button>
      </div>
    </div>
    <div class="t-card-body t-stack" data-gap="2">
      {a.info ? (
        <p class="t-small t-muted" safe>
          {`${a.info.templates.join(' → ')}${a.info.description ? ` · ${a.info.description}` : ''}`}
        </p>
      ) : (
        <div class="t-alert" data-tone="warning" data-size="sm" role="alert">
          <Icon id="bi-exclamation-triangle" />
          <div class="t-alert-body">This set no longer exists; plans fail until it is removed or created again.</div>
        </div>
      )}
      {a.fields.length ? (
        <div class="t-settings values-editor">
          {a.fields.map((f) => {
            const id = `v-${a.set}-${f.key}`
            return (
              <div class="t-setting" data-key={f.key}>
                <div class="t-setting-label">
                  <label for={id} class="t-mono" safe>
                    {f.key}
                  </label>
                  <span class="t-help" data-tone="info">
                    <button class="t-help-btn" type="button" aria-expanded="false" aria-label={`About ${f.key}`}>
                      i
                    </button>
                    <div class="t-help-box" hidden>
                      <p safe>{`Used in ${f.used_in.join(', ')}.`}</p>
                      <p class="t-muted t-small" safe>
                        {a.info && Object.hasOwn(a.info.values, f.key) ? `Set default: ${String(a.info.values[f.key])}` : 'The set has no default: this repo needs a value.'}
                      </p>
                    </div>
                  </span>
                </div>
                <div class="t-setting-control">
                  <ValueControl field={f} value={a.values[f.key]} fallback={a.info?.values[f.key]} lookups={lookups} id={id} />
                </div>
                <span class="t-setting-state" aria-live="polite"></span>
              </div>
            )
          })}
        </div>
      ) : (
        <p class="t-small t-muted">This set's templates take no values.</p>
      )}
    </div>
  </div>
)

export const RepoPage = ({ repo, assigned, sets, lookups, lookupError }: RepoData) => {
  const unassigned = sets.filter((s) => !assigned.some((a) => a.set === s.name))
  return (
    <div class="t-stack" data-gap="4" id="repo-page" data-repo={repo.full_name}>
      <PageHeader title={repo.full_name} back={{ href: '/', label: 'Back to repos' }}>
        <a class="t-btn" href={`https://github.com/${repo.full_name}`} target="_blank" rel="noopener">
          <Icon id="bi-box-arrow-up-right" /> GitHub
        </a>
        <button class="t-btn" data-action="repo-audit">
          <Icon id="bi-shield-check" /> Audit
        </button>
        <button class="t-btn" data-variant="primary" data-action="repo-plan">
          <Icon id="bi-eye" /> Plan
        </button>
        <button class="t-btn" data-variant="ghost" data-tone="danger" data-action="repo-delete">
          <Icon id="bi-trash" /> Delete
        </button>
      </PageHeader>
      <dl class="t-facts">
        <dt>Visibility</dt>
        <dd>
          <VisibilityBadge visibility={repo.visibility} />
        </dd>
        <dt>Default branch</dt>
        <dd class="t-mono" safe>
          {repo.default_branch}
        </dd>
        <dt>State</dt>
        <dd id="repo-drift">
          <DriftBadge state={repo.drift_state} /> <span class="t-small t-muted">last audit </span>
          <RelTime at={repo.last_audit_at} />
        </dd>
        {repo.description ? (
          <>
            <dt>Description</dt>
            <dd safe>{repo.description}</dd>
          </>
        ) : null}
      </dl>

      <section class="t-section" id="assigned">
        <h2 class="t-section-title">Assigned sets</h2>
        <div class="t-section-body t-stack" data-gap="3">
          {lookupError ? (
            <p class="t-small t-muted" safe>
              {`Branch and check lists are unavailable: ${lookupError}`}
            </p>
          ) : null}
          <div class="t-stack" data-gap="2" id="assigned-sets">
            {assigned.length ? (
              assigned.map((a, i) => <AssignedSet a={a} index={i} total={assigned.length} lookups={lookups} />)
            ) : (
              <Empty icon="bi-collection" title="No sets assigned" text="Add a set below; audits and plans then compare this repo with it." size="sm" />
            )}
          </div>
          <div class="t-toolbar" role="toolbar" aria-label="Add a set">
            {unassigned.length ? (
              <>
                <select class="t-select" data-size="sm" data-width="auto" id="add-set" aria-label="Set to add">
                  {unassigned.map((s) => (
                    <option value={s.name} safe>
                      {s.name}
                    </option>
                  ))}
                </select>
                <button class="t-btn" data-size="sm" data-action="set-add">
                  <Icon id="bi-plus-lg" /> Add set
                </button>
              </>
            ) : (
              <span class="t-small t-muted">
                Every set is assigned. <a href="/sets/new">Create another set</a>.
              </span>
            )}
          </div>
        </div>
      </section>

      <section class="t-section" id="plan">
        <h2 class="t-section-title">Plan</h2>
        <div class="t-section-body t-stack" data-gap="3">
          <div id="plan-body">
            <p class="t-muted">Press Plan to compare this repo with its sets. Nothing changes until you apply.</p>
          </div>
          <div class="t-toolbar" id="plan-actions" hidden>
            <button class="t-btn" data-variant="primary" data-action="repo-apply">
              <Icon id="bi-play-fill" /> Apply
            </button>
          </div>
          <div id="apply-report"></div>
        </div>
      </section>

      <section class="t-section" id="events">
        <h2 class="t-section-title">Recent events</h2>
        <div class="t-section-body">
          {repo.events.length ? (
            <EventsTable events={repo.events} showRepo={false} />
          ) : (
            <Empty icon="bi-clock-history" title="No events yet" text="Plans, applies and audits of this repo show up here." size="sm" />
          )}
        </div>
      </section>
      <DiffDialog />
      <EventDialog />
    </div>
  )
}

/** Apply outcome: one row per change with its outcome and message. */
export const ApplyReportView = ({ report }: { report: { status: string; applied: number; failed: number; results: { change: { section: string; target: string; op: string }; outcome: string; message: string }[]; skipped: { section: string; reason: string }[] } }) => (
  <div class="t-stack" data-gap="2">
    <div class="t-cluster" data-gap="2">
      <span class="t-badge" data-tone={report.status === 'ok' ? 'success' : report.status === 'partial' ? 'warning' : 'danger'} safe>
        {report.status}
      </span>
      <span class="t-small t-muted">{`${String(report.applied)} applied · ${String(report.failed)} failed · ${String(report.skipped.length)} skipped`}</span>
    </div>
    {report.results.length ? (
      <ul class="t-plain-list t-small">
        {report.results.map((r) => (
          <li>
            <span class="t-badge" data-size="xs" data-tone={r.outcome === 'applied' ? 'success' : r.outcome === 'failed' ? 'danger' : 'neutral'} safe>
              {r.outcome}
            </span>{' '}
            <b safe>{r.change.section}</b> <span class="t-mono" safe>{r.change.target}</span> <span class="t-muted" safe>{r.message}</span>
          </li>
        ))}
      </ul>
    ) : null}
  </div>
)
