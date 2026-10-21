import { DriftBadge, Empty, Icon, PageHeader, RelTime, VisibilityBadge } from './parts'
import type { RepoView, SetView } from './types'

export type ReposData = { repos: RepoView[]; sets: SetView[]; defaultOwner: string; error?: string }

export const owners = (repos: RepoView[], defaultOwner = '') => [...new Set([defaultOwner, ...repos.map((r) => r.owner)].filter(Boolean))].sort((a, b) => a.localeCompare(b))

const DRIFT_FILTERS: [string, string][] = [
  ['', 'All'],
  ['clean', 'In sync'],
  ['drift', 'Drift'],
  ['error', 'Error'],
  ['unknown', 'Not audited'],
]

/** Set checkboxes; shared by the bulk dialog, the create dialog and the repo page. */
export const SetChecks = ({ sets, name, checked = [], legend }: { sets: SetView[]; name: string; checked?: string[]; legend: string }) =>
  sets.length ? (
    <fieldset class="t-check-group set-checks" data-name={name}>
      <legend class="t-label" safe>
        {legend}
      </legend>
      {sets.map((s) => (
        <label class="t-check">
          <input class="t-check-input" type="checkbox" name={name} value={s.name} checked={checked.includes(s.name)} />
          <span class="t-check-label">
            <span safe>{s.name}</span>
            <span class="t-check-desc" safe>
              {`${s.templates.join(' → ')}${s.description ? ` · ${s.description}` : ''}`}
            </span>
          </span>
        </label>
      ))}
    </fieldset>
  ) : (
    <p class="t-muted">
      No sets yet. <a href="/sets/new">Create a set</a> first.
    </p>
  )

export const RepoRows = ({ repos }: { repos: RepoView[] }) => (
  <tbody id="repo-rows">
    {repos.map((r) => (
      <tr
        data-repo={r.full_name}
        data-owner={r.owner}
        data-visibility={r.visibility}
        data-drift={r.drift_state}
        data-sets={r.sets.map((s) => s.set).join(' ')}
        data-name={r.full_name.toLowerCase()}
        data-audit={r.last_audit_at ?? ''}
      >
        <td class="t-col-icon">
          <label class="t-check">
            <input class="t-check-input" type="checkbox" data-select-repo value={r.full_name} aria-label={`Select ${r.full_name}`} />
          </label>
        </td>
        <td>
          <a href={`/repos/${r.full_name}`} class="repo-link">
            <span class="t-muted" safe>{`${r.owner}/`}</span>
            <b safe>{r.name}</b>
          </a>
          {r.archived ? (
            <span class="t-badge" data-tone="neutral" data-size="xs">
              archived
            </span>
          ) : null}
          {r.fork ? (
            <span class="t-badge" data-tone="neutral" data-size="xs">
              fork
            </span>
          ) : null}
          {r.description ? (
            <div class="t-small t-muted t-truncate repo-desc" safe>
              {r.description}
            </div>
          ) : null}
        </td>
        <td class="t-col-shrink">
          <VisibilityBadge visibility={r.visibility} />
        </td>
        <td>
          <div class="t-cluster" data-gap="1">
            {r.sets.length ? (
              r.sets.map((s) => (
                <span class="t-chip" data-tone="accent" safe>
                  {s.set}
                </span>
              ))
            ) : (
              <span class="t-muted t-small">none</span>
            )}
          </div>
        </td>
        <td class="t-col-shrink" data-cell="drift">
          <DriftBadge state={r.drift_state} />
        </td>
        <td class="t-col-shrink" data-sort-value={r.last_audit_at ?? ''}>
          <RelTime at={r.last_audit_at} />
        </td>
      </tr>
    ))}
  </tbody>
)

export const ReposPage = ({ repos, sets, defaultOwner, error }: ReposData) => {
  const ownerList = owners(repos, defaultOwner)
  return (
    <>
      <PageHeader title="Repos" lead="Pick repos, choose sets, review the plan, apply.">
        <button class="t-btn" data-action="repos-refresh">
          <Icon id="bi-arrow-repeat" /> Refresh from GitHub
        </button>
        <button class="t-btn" data-variant="primary" data-dialog-open="create-dlg">
          <Icon id="bi-plus-lg" /> New repo
        </button>
      </PageHeader>
      {error ? (
        <div class="t-alert" data-tone="warning" role="alert">
          <Icon id="bi-exclamation-triangle" />
          <div class="t-alert-body">
            <b>Repos could not be listed:</b> <span safe>{error}</span>
          </div>
          <div class="t-alert-actions">
            <a class="t-btn" data-size="sm" href="/settings#github">
              GitHub settings
            </a>
          </div>
        </div>
      ) : null}
      <div class="t-stack" data-gap="3" id="repos">
        <div class="t-toolbar" role="toolbar" aria-label="Filter repos">
          <input class="t-input" data-width="auto" data-size="sm" type="search" id="repo-q" data-repo-filter="q" placeholder="Search repos ( / )" aria-label="Search repos" />
          <select class="t-select" data-size="sm" data-width="auto" data-repo-filter="owner" aria-label="Owner">
            <option value="">All owners</option>
            {ownerList.map((o) => (
              <option value={o} safe>
                {o}
              </option>
            ))}
          </select>
          <div class="t-btn-group" role="group" data-role="filter" data-repo-filter="visibility" aria-label="Visibility">
            {[
              ['', 'All'],
              ['public', 'Public'],
              ['private', 'Private'],
            ].map(([v, l], i) => (
              <button class="t-btn" data-size="sm" data-value={v} aria-pressed={i === 0 ? 'true' : 'false'}>
                {l}
              </button>
            ))}
          </div>
          <div class="t-btn-group" role="group" data-role="filter" data-repo-filter="drift" aria-label="Drift">
            {DRIFT_FILTERS.map(([v, l], i) => (
              <button class="t-btn" data-size="sm" data-value={v} aria-pressed={i === 0 ? 'true' : 'false'}>
                {l}
              </button>
            ))}
          </div>
          <select class="t-select" data-size="sm" data-width="auto" data-repo-filter="set" aria-label="Set">
            <option value="">Any set</option>
            <option value="-">No set</option>
            {sets.map((s) => (
              <option value={s.name} safe>
                {s.name}
              </option>
            ))}
          </select>
        </div>
        <div class="t-toolbar selection-bar" id="selection-bar" role="toolbar" aria-label="Selected repos" hidden>
          <span class="t-badge" data-tone="accent" id="selection-count">
            0 selected
          </span>
          <button class="t-btn" data-size="sm" data-variant="primary" data-action="bulk-open">
            <Icon id="bi-eye" /> Plan sets…
          </button>
          <button class="t-btn" data-size="sm" data-action="bulk-audit">
            <Icon id="bi-shield-check" /> Audit
          </button>
          <span class="t-toolbar-spacer"></span>
          <button class="t-btn" data-size="sm" data-variant="ghost" data-action="selection-clear">
            Clear selection
          </button>
        </div>
        {repos.length ? (
          <div class="t-table-wrap">
            <table class="t-table" data-variant="data" data-density="compact" id="repo-table" aria-label="Repositories">
              <thead>
                <tr>
                  <th class="t-col-icon">
                    <label class="t-check">
                      <input class="t-check-input" type="checkbox" data-select-all aria-label="Select all shown repos" />
                    </label>
                  </th>
                  <th data-sort="name" aria-sort="ascending">
                    <button type="button">
                      Repository <span class="t-sort-icon"></span>
                    </button>
                  </th>
                  <th class="t-col-shrink" data-sort="visibility">
                    <button type="button">
                      Visibility <span class="t-sort-icon"></span>
                    </button>
                  </th>
                  <th>Sets</th>
                  <th class="t-col-shrink" data-sort="drift">
                    <button type="button">
                      State <span class="t-sort-icon"></span>
                    </button>
                  </th>
                  <th class="t-col-shrink" data-sort="audit">
                    <button type="button">
                      Last audit <span class="t-sort-icon"></span>
                    </button>
                  </th>
                </tr>
              </thead>
              <RepoRows repos={repos} />
            </table>
            <div class="t-empty" data-size="sm" id="repo-no-match" hidden>
              <svg class="t-icon t-empty-icon" aria-hidden="true">
                <use href="/tailor/icons.svg#bi-search" />
              </svg>
              <p>No repo matches these filters. Clear the search or pick another filter.</p>
            </div>
          </div>
        ) : (
          <Empty icon="bi-inbox" title="No repos yet" text="Refresh from GitHub to list the repos the credential can reach, or create a new one.">
            <button class="t-btn" data-variant="primary" data-action="repos-refresh">
              <Icon id="bi-arrow-repeat" /> Refresh from GitHub
            </button>
            <button class="t-btn" data-dialog-open="create-dlg">
              <Icon id="bi-plus-lg" /> New repo
            </button>
          </Empty>
        )}
      </div>
      <BulkDialog sets={sets} />
      <DiffDialog />
      <CreateRepoDialog owners={ownerList} defaultOwner={defaultOwner} sets={sets} />
    </>
  )
}

/** Choose sets → plan each selected repo → review → apply in bulk with live per-repo progress. */
const BulkDialog = ({ sets }: { sets: SetView[] }) => (
  <dialog class="t-dialog" id="bulk-dlg" data-size="lg" aria-labelledby="bulk-dlg-title">
    <div class="t-dialog-header">
      <h2 class="t-dialog-title" id="bulk-dlg-title">
        Plan sets on <span data-role="count">0 repos</span>
      </h2>
      <button class="t-dialog-close" aria-label="Close" data-dialog-close>
        ×
      </button>
    </div>
    <div class="t-dialog-body t-stack" data-gap="3">
      <div data-step="pick" class="t-stack" data-gap="3">
        <label class="t-check" data-variant="switch">
          <input class="t-check-input" type="checkbox" role="switch" name="bulk-assigned" checked />
          <span class="t-check-label">
            Use each repo's assigned sets
            <span class="t-check-desc">Off: apply the sets ticked below to every selected repo instead.</span>
          </span>
        </label>
        <div data-role="set-picker" hidden>
          <SetChecks sets={sets} name="bulk-set" legend="Sets, applied in this order" />
        </div>
      </div>
      <div data-step="results" class="t-stack" data-gap="2" hidden>
        <div class="t-progress" data-size="sm" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100" aria-label="Progress">
          <div class="t-progress-bar" style="--t-value: 0%"></div>
        </div>
        <div class="t-table-wrap">
          <table class="t-table" data-density="compact" aria-label="Per-repo results">
            <thead>
              <tr>
                <th>Repository</th>
                <th class="t-col-shrink">Status</th>
                <th>Summary</th>
                <th class="t-col-actions">Diff</th>
              </tr>
            </thead>
            <tbody data-role="results"></tbody>
          </table>
        </div>
        <p class="t-small t-muted">Bulk apply never runs destructive changes; apply those on the repo page with its typed confirm.</p>
      </div>
    </div>
    <div class="t-dialog-footer">
      <button class="t-btn" data-dialog-close>
        Close
      </button>
      <button class="t-btn" data-action="bulk-plan" data-variant="primary">
        <Icon id="bi-eye" /> Plan
      </button>
      <button class="t-btn" data-action="bulk-apply" data-variant="primary" hidden>
        <Icon id="bi-play-fill" /> <span data-role="apply-label">Apply</span>
      </button>
    </div>
  </dialog>
)

export const DiffDialog = () => (
  <dialog class="t-dialog" id="diff-dlg" data-size="xl" aria-labelledby="diff-dlg-title">
    <div class="t-dialog-header">
      <h2 class="t-dialog-title" id="diff-dlg-title">
        Plan
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

const CreateRepoDialog = ({ owners: list, defaultOwner, sets }: { owners: string[]; defaultOwner: string; sets: SetView[] }) => (
  <dialog class="t-dialog" id="create-dlg" data-size="md" aria-labelledby="create-dlg-title">
    <form class="t-form" id="create-repo-form" novalidate>
      <div class="t-dialog-header">
        <h2 class="t-dialog-title" id="create-dlg-title">
          New repository
        </h2>
        <button class="t-dialog-close" type="button" aria-label="Close" data-dialog-close>
          ×
        </button>
      </div>
      <div class="t-dialog-body t-stack" data-gap="3">
        <div class="t-field">
          <label class="t-label" for="cr-owner">
            Owner
          </label>
          <select class="t-select" id="cr-owner" name="owner" data-other="cr-owner-other">
            {list.length ? null : <option value="">The credential's own account</option>}
            {list.map((o) => (
              <option value={o} selected={o === (defaultOwner || list[0])} safe>
                {o}
              </option>
            ))}
            <option value="__other">Other…</option>
          </select>
          <input class="t-input" id="cr-owner-other" name="owner_other" placeholder="Organisation or user login" aria-label="Other owner" hidden />
        </div>
        <div class="t-field">
          <label class="t-label" for="cr-name">
            Name
          </label>
          <input class="t-input" id="cr-name" name="name" required maxlength="100" pattern="[A-Za-z0-9._\-]+" autocomplete="off" spellcheck="false" />
          <p class="t-hint">
            Created as <code data-role="full-name">owner/name</code>
          </p>
        </div>
        <div class="t-field">
          <span class="t-label" id="cr-vis-label">
            Visibility
          </span>
          <div class="t-segmented" role="group" aria-labelledby="cr-vis-label">
            <label class="t-segmented-item">
              <input class="t-segmented-input" type="radio" name="visibility" value="private" checked />
              <span>
                <Icon id="bi-lock" /> Private
              </span>
            </label>
            <label class="t-segmented-item">
              <input class="t-segmented-input" type="radio" name="visibility" value="public" />
              <span>
                <Icon id="bi-globe" /> Public
              </span>
            </label>
          </div>
        </div>
        <div class="t-field">
          <label class="t-label" for="cr-desc">
            Description
          </label>
          <input class="t-input" id="cr-desc" name="description" maxlength="350" />
        </div>
        <SetChecks sets={sets} name="sets" legend="Assign sets (applied after creation)" />
      </div>
      <div class="t-dialog-footer">
        <button class="t-btn" type="button" data-dialog-close>
          Cancel
        </button>
        <button class="t-btn" type="submit" data-variant="primary">
          <Icon id="bi-plus-lg" /> Create
        </button>
      </div>
    </form>
  </dialog>
)
