import { EventDiff } from './diff'
import { Empty, Icon, OutcomeBadge, PageHeader, RelTime } from './parts'
import type { EventView, RunView } from './types'

export type AuditFilter = { repo?: string; section?: string; source?: string; actor?: string; outcome?: string; since?: string }

export type AuditData = {
  events: EventView[]
  runs: RunView[]
  filter: AuditFilter
  /** Known values for the pickers. */
  repos: string[]
  sections: string[]
  actors: string[]
}

export const SOURCES = ['ui', 'cli', 'api', 'mcp', 'scheduler']
export const OUTCOMES = ['applied', 'skipped', 'failed', 'planned', 'drift', 'clean', 'info']
/** Since presets: value = seconds back from now. */
export const SINCE: [string, string][] = [
  ['', 'Any time'],
  ['3600', 'Last hour'],
  ['86400', 'Last 24 hours'],
  ['604800', 'Last 7 days'],
  ['2592000', 'Last 30 days'],
]

export const EventsTable = ({ events, showRepo = true }: { events: EventView[]; showRepo?: boolean }) => (
  <div class="t-table-wrap">
    <table class="t-table" data-variant="data" data-density="compact" aria-label="Events">
      <thead>
        <tr>
          <th class="t-col-shrink">When</th>
          {showRepo ? <th>Repository</th> : null}
          <th class="t-col-shrink">Section</th>
          <th>Action</th>
          <th class="t-col-shrink">Outcome</th>
          <th class="t-col-shrink">Who</th>
          <th class="t-col-actions">
            <span class="t-visually-hidden">Details</span>
          </th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev) => (
          <tr data-event={ev.id} data-tone={ev.outcome === 'failed' ? 'danger' : ev.outcome === 'drift' ? 'warning' : undefined} class="event-row" tabindex="0">
            <td class="t-col-shrink">
              <RelTime at={ev.at} />
            </td>
            {showRepo ? (
              <td>
                {ev.repo ? (
                  <a href={`/repos/${ev.repo}`} safe>
                    {ev.repo}
                  </a>
                ) : (
                  <span class="t-muted">—</span>
                )}
              </td>
            ) : null}
            <td class="t-col-shrink" safe>
              {ev.section ?? '—'}
            </td>
            <td>
              <span class="t-mono" safe>
                {ev.action}
              </span>
              {ev.message ? (
                <div class="t-small t-muted t-truncate event-msg" safe>
                  {ev.message}
                </div>
              ) : null}
            </td>
            <td class="t-col-shrink">
              <OutcomeBadge outcome={ev.outcome} />
            </td>
            <td class="t-col-shrink t-small">
              <span safe>{ev.actor}</span> <span class="t-muted" safe>{`via ${ev.source}`}</span>
            </td>
            <td class="t-col-actions">
              <button class="t-btn" data-size="xs" data-variant="ghost" data-icon="only" data-action="event-open" aria-label="Open the diff" data-tip="Diff">
                <Icon id="bi-eye" />
              </button>
              <template data-role="diff">
                <div class="t-stack" data-gap="2">
                  <dl class="t-facts">
                    <dt>When</dt>
                    <dd>
                      <RelTime at={ev.at} />
                    </dd>
                    <dt>Who</dt>
                    <dd safe>{`${ev.actor} via ${ev.source}`}</dd>
                    {ev.repo ? (
                      <>
                        <dt>Repository</dt>
                        <dd safe>{ev.repo}</dd>
                      </>
                    ) : null}
                    <dt>Action</dt>
                    <dd class="t-mono" safe>
                      {`${ev.section ? `${ev.section}: ` : ''}${ev.action}`}
                    </dd>
                    <dt>Outcome</dt>
                    <dd>
                      <OutcomeBadge outcome={ev.outcome} />
                    </dd>
                    {ev.message ? (
                      <>
                        <dt>Message</dt>
                        <dd safe>{ev.message}</dd>
                      </>
                    ) : null}
                    {ev.run_id ? (
                      <>
                        <dt>Run</dt>
                        <dd class="t-mono" safe>
                          {ev.run_id}
                        </dd>
                      </>
                    ) : null}
                  </dl>
                  <EventDiff diff={ev.diff} />
                </div>
              </template>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const runTone: Record<string, string> = { ok: 'success', running: 'info', drift: 'warning', partial: 'warning', failed: 'danger' }

export const RunsTable = ({ runs }: { runs: RunView[] }) =>
  runs.length ? (
    <div class="t-table-wrap">
      <table class="t-table" data-variant="data" data-density="compact" aria-label="Runs">
        <thead>
          <tr>
            <th class="t-col-shrink">Started</th>
            <th class="t-col-shrink">Kind</th>
            <th class="t-col-shrink">Status</th>
            <th>Summary</th>
            <th class="t-col-shrink">Who</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr data-run={r.id}>
              <td class="t-col-shrink">
                <RelTime at={r.started_at} />
              </td>
              <td class="t-col-shrink" safe>
                {r.kind}
              </td>
              <td class="t-col-shrink">
                <span class="t-badge" data-tone={runTone[r.status] ?? 'neutral'} safe>
                  {r.status}
                </span>
              </td>
              <td class="t-small t-mono t-truncate run-summary" safe>
                {Object.entries(r.summary)
                  .map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
                  .join(' ')}
              </td>
              <td class="t-col-shrink t-small">
                <span safe>{r.actor}</span> <span class="t-muted" safe>{`via ${r.source}`}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <Empty icon="bi-clock-history" title="No runs yet" text="Plan, apply or audit a repo; each run shows up here with its status." size="sm" />
  )

const FilterSelect = ({ name, label, all, options, value }: { name: keyof AuditFilter; label: string; all: string; options: [string, string][]; value?: string }) => (
  <select class="t-select" data-size="sm" data-width="auto" name={name} aria-label={label}>
    <option value="" safe>
      {all}
    </option>
    {options.map(([v, l]) => (
      <option value={v} selected={v === value} safe>
        {l}
      </option>
    ))}
  </select>
)

const pairs = (xs: string[]): [string, string][] => xs.map((x) => [x, x])

export const EventsBlock = ({ events }: { events: EventView[] }) => (
  <div id="events-block" data-live="event">
    {events.length ? (
      <EventsTable events={events} />
    ) : (
      <Empty icon="bi-funnel" title="No events match" text="Pick another filter or a longer time range; new plans, applies and audits appear here live." size="sm" />
    )}
  </div>
)

export const AuditPage = ({ events, runs, filter, repos, sections, actors }: AuditData) => (
  <>
    <PageHeader title="Audit" lead="Who changed what, when, and from where.">
      <button class="t-btn" data-action="audit-all">
        <Icon id="bi-shield-check" /> Audit every assigned repo
      </button>
    </PageHeader>
    <div class="t-stack" data-gap="4">
      <section class="t-section">
        <h2 class="t-section-title">Events</h2>
        <div class="t-section-body t-stack" data-gap="3">
          <form class="t-toolbar" id="audit-filter" role="toolbar" aria-label="Filter events" data-partial-target="events-block">
            <FilterSelect name="repo" label="Repository" all="All repos" options={pairs(repos)} value={filter.repo} />
            <FilterSelect name="section" label="Section" all="All sections" options={pairs(sections)} value={filter.section} />
            <FilterSelect name="source" label="Source" all="All sources" options={pairs(SOURCES)} value={filter.source} />
            <FilterSelect name="actor" label="Who" all="Everyone" options={pairs(actors)} value={filter.actor} />
            <FilterSelect name="outcome" label="Outcome" all="All outcomes" options={pairs(OUTCOMES)} value={filter.outcome} />
            <FilterSelect name="since" label="Time range" all="Any time" options={SINCE.slice(1)} value={filter.since} />
          </form>
          <EventsBlock events={events} />
        </div>
      </section>
      <section class="t-section">
        <h2 class="t-section-title">Runs</h2>
        <div class="t-section-body" id="runs-block" data-live="run">
          <RunsTable runs={runs} />
        </div>
      </section>
    </div>
    <EventDialog />
  </>
)

export const EventDialog = () => (
  <dialog class="t-dialog" id="event-dlg" data-size="lg" aria-labelledby="event-dlg-title">
    <div class="t-dialog-header">
      <h2 class="t-dialog-title" id="event-dlg-title">
        Event
      </h2>
      <button class="t-dialog-close" aria-label="Close" data-dialog-close>
        ×
      </button>
    </div>
    <div class="t-dialog-body" data-role="body"></div>
    <div class="t-dialog-footer">
      <button class="t-btn" data-dialog-close>
        Close
      </button>
    </div>
  </dialog>
)
