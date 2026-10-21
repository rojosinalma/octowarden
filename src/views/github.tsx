import type { GitHubStatus, InstallationStatus, PermissionRow } from '../github/status'
import { e, Icon, plural, RelTime } from './parts'

export type ManifestView = {
  /** Pretty-printed manifest JSON. */
  json: string
  /** One-time state the callback checks. */
  state: string
  /** Organizations the token can create an App in (owner picker); empty → personal account only. */
  orgs: string[]
  login?: string
  /** App credentials exist: the block starts collapsed. */
  configured: boolean
}

/** Outcome of "Create the App on GitHub", shown once after the redirect back. */
export type AppCreatedView = { ok: true; slug: string; install_url: string } | { ok: false; message: string }

const KIND_LABEL: Record<string, string> = { app: 'GitHub App', 'pat-classic': 'classic token', 'pat-fine-grained': 'fine-grained token' }
const MODE_LABEL: Record<string, string> = { pat: 'Personal access token', gh: 'gh CLI login', app: 'GitHub App', none: 'Not configured', fake: 'Test client' }
const SOURCE_LABEL: Record<string, string> = { settings: 'these settings', octoforge: 'Octoforge', env: 'environment variables', 'gh-cli': 'the gh CLI', none: 'nowhere' }

/** Definite gaps: scopes for a classic token, permissions otherwise. */
export function gapCount(s: GitHubStatus | undefined): number {
  if (!s) return 0
  return s.kind === 'pat-classic' ? (s.missing_scopes?.length ?? 0) : s.missing.length
}

export function stateOf(s: GitHubStatus): { tone: string; text: string } {
  if (s.mode === 'none' && !s.error) return { tone: 'neutral', text: 'not configured' }
  if (s.error) return { tone: 'warning', text: 'unknown' }
  const gaps = gapCount(s)
  if (gaps) return { tone: 'danger', text: `${String(gaps)} missing` }
  if (s.installations && !s.installations.length) return { tone: 'warning', text: 'not installed' }
  if (s.permissions.every((p) => p.ok === null)) return { tone: 'info', text: 'unknown' }
  return { tone: 'success', text: 'ok' }
}

export const GitHubStateBadge = ({ status, id }: { status: GitHubStatus; id?: string }) => {
  const st = stateOf(status)
  return (
    <span class="t-badge" data-tone={st.tone} id={id} data-github-state={st.text} safe>
      {st.text}
    </span>
  )
}

const grantedTone = (p: PermissionRow) => (p.ok === true ? 'success' : p.ok === false ? 'danger' : 'neutral')

const UsedBy = ({ p }: { p: PermissionRow }) => (
  <span class="t-cluster" data-gap="1">
    {p.sections.map((s) => (
      <code safe>{s}</code>
    ))}
    {(p.features ?? []).map((f) => (
      <span class="t-muted t-small" safe>
        {f}
      </span>
    ))}
  </span>
)

const PermissionTable = ({ status }: { status: GitHubStatus }) => (
  <div class="t-table-wrap">
    <table class="t-table" data-variant="data" data-density="compact" id="github-permissions">
      <thead>
        <tr>
          <th>Permission</th>
          <th>Needed</th>
          <th>Granted</th>
          <th>Used by</th>
          <th>What breaks without it</th>
        </tr>
      </thead>
      <tbody>
        {status.permissions.map((p) => (
          <tr data-permission={p.key} data-tone={p.ok === false ? 'danger' : undefined}>
            <td>
              <code safe>{p.key}</code>
              {status.kind === 'pat-classic' ? (
                <span class="t-muted t-small" safe>
                  {` scope ${p.scope}`}
                </span>
              ) : null}
            </td>
            <td safe>{p.level}</td>
            <td>
              <span class="t-badge" data-tone={grantedTone(p)} safe>
                {p.note ? 'n/a' : p.granted}
              </span>
              {p.via ? (
                <span class="t-muted t-small" safe>
                  {` via ${p.via}`}
                </span>
              ) : null}
              {p.note ? (
                <div class="t-muted t-small" safe>
                  {p.note}
                </div>
              ) : null}
            </td>
            <td>
              <UsedBy p={p} />
            </td>
            <td>
              <span safe>{p.breaks}</span>
              <span class="t-muted t-small gh-why" safe>
                {p.why}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const ScopeTable = ({ status }: { status: GitHubStatus }) => (
  <div class="t-table-wrap">
    <table class="t-table" data-variant="data" data-density="compact" id="github-scopes">
      <thead>
        <tr>
          <th>Token scope</th>
          <th>Granted</th>
          <th>Used for</th>
          <th>What breaks without it</th>
        </tr>
      </thead>
      <tbody>
        {(status.scopes ?? []).map((s) => (
          <tr data-scope={s.key} data-tone={s.ok === false ? 'danger' : undefined}>
            <td>
              <code safe>{s.key}</code>
            </td>
            <td>
              <span class="t-badge" data-tone={s.ok === true ? 'success' : s.ok === false ? 'danger' : 'neutral'}>
                {s.ok === true ? 'yes' : s.ok === false ? 'no' : 'unknown'}
              </span>
            </td>
            <td safe>{s.why}</td>
            <td safe>{s.breaks}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

const selection = (i: InstallationStatus) =>
  i.repository_selection === 'all' ? 'all repositories' : i.repo_count !== undefined ? plural(i.repo_count, 'selected repository', 'selected repositories') : 'selected repositories'

const InstallationsTable = ({ status }: { status: GitHubStatus }) => (
  <div class="t-table-wrap">
    <table class="t-table" data-variant="data" data-density="compact" id="github-installations">
      <thead>
        <tr>
          <th>Installed on</th>
          <th>Repositories</th>
          <th>Missing permissions</th>
          <th class="t-col-actions">Actions</th>
        </tr>
      </thead>
      <tbody>
        {(status.installations ?? []).map((i) => (
          <tr data-installation={String(i.id)} data-account={i.account} data-tone={i.missing.length ? 'danger' : undefined}>
            <td>
              <span class="t-cluster" data-gap="1">
                <a href={`https://github.com/${i.account}`} target="_blank" rel="noopener" safe>
                  {i.account}
                </a>
                <span class="t-badge" data-size="xs" data-tone="neutral">
                  {i.type === 'org' ? 'organization' : 'user'}
                </span>
                {status.installation_id === i.id ? (
                  <span class="t-badge" data-size="xs" data-tone="info" data-tip="Pinned by the Installation ID setting">
                    pinned
                  </span>
                ) : null}
              </span>
            </td>
            <td safe>{selection(i)}</td>
            <td>
              {i.missing.length ? (
                <span class="t-cluster" data-gap="1">
                  {i.missing.map((m) => (
                    <code safe>{m}</code>
                  ))}
                </span>
              ) : (
                <span class="t-badge" data-tone="success">
                  none
                </span>
              )}
            </td>
            <td class="t-col-actions">
              <a class="t-btn" data-size="xs" href={i.url} target="_blank" rel="noopener" data-tip="The account owner accepts new permissions here">
                <Icon id="bi-box-arrow-up-right" /> Review on GitHub
              </a>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
)

/** Required versus granted, installations, links to fix gaps and the Re-check button. Replaced whole after a re-check. */
export const GitHubAccess = ({ status }: { status: GitHubStatus }) => {
  const st = stateOf(status)
  const gaps = gapCount(status)
  return (
    <div class="t-stack" data-gap="3" id="github-access" data-state={st.text}>
      {status.error ? (
        <div class="t-alert" data-tone="warning" role="alert">
          <Icon id="bi-exclamation-triangle" />
          <div class="t-alert-body">
            <b>GitHub could not be asked:</b> <span safe>{status.error}</span>. The permissions below stay unknown until a check succeeds; nothing is skipped meanwhile.
          </div>
        </div>
      ) : gaps ? (
        <div class="t-alert" data-tone="danger" role="alert" id="github-gaps">
          <Icon id="bi-x-circle" />
          <div class="t-alert-body">
            <b>{status.kind === 'pat-classic' ? `The token lacks ${plural(gaps, 'scope')}:` : `The credential lacks ${plural(gaps, 'permission')}:`}</b>{' '}
            <span safe>{(status.kind === 'pat-classic' ? (status.missing_scopes ?? []) : status.missing).join(', ')}</span>. Sections that need them are skipped in plans with the reason.
            {status.kind === 'app'
              ? status.app_missing?.length
                ? ' Add them on the App first (Edit permissions on GitHub), then accept them on each installation.'
                : ' The App asks for them already: the owner of each installation must accept them.'
              : null}
          </div>
        </div>
      ) : null}
      {status.note ? (
        <p class="t-muted t-small" safe>
          {status.note}
        </p>
      ) : null}
      <dl class="t-facts" id="github-facts">
        <dt>In use</dt>
        <dd>
          <span safe>{`${MODE_LABEL[status.mode] ?? status.mode}${status.kind && status.kind !== 'app' ? ` (${KIND_LABEL[status.kind]})` : ''}`}</span>
          {status.delivered ? (
            <>
              {' '}
              <span class="t-badge" data-tone="purple" data-size="xs">
                delivered by octoforge
              </span>
            </>
          ) : null}
        </dd>
        <dt>From</dt>
        <dd safe>{SOURCE_LABEL[status.source] ?? status.source}</dd>
        {status.app_slug ? (
          <>
            <dt>App</dt>
            <dd>
              <a class="t-mono" href={status.app_url ?? `https://github.com/apps/${status.app_slug}`} target="_blank" rel="noopener" safe>
                {status.app_slug}
              </a>
            </dd>
          </>
        ) : status.identity ? (
          <>
            <dt>Acting as</dt>
            <dd>
              <a href={`https://github.com/${status.identity}`} target="_blank" rel="noopener" safe>
                {status.identity}
              </a>
            </dd>
          </>
        ) : null}
        <dt>Checked</dt>
        <dd>
          <RelTime at={status.checked_at} />
        </dd>
      </dl>
      {status.installations?.length ? <InstallationsTable status={status} /> : null}
      {status.scopes ? <ScopeTable status={status} /> : null}
      {status.mode !== 'none' ? <PermissionTable status={status} /> : null}
      <div class="t-toolbar" data-gap="2">
        <button class="t-btn" type="button" data-size="sm" data-action="github-recheck" data-tip="Drop the cached answer and ask GitHub again">
          <Icon id="bi-arrow-repeat" /> Re-check
        </button>
        {status.permissions_url ? (
          <a class="t-btn" data-size="sm" href={status.permissions_url} target="_blank" rel="noopener" data-variant={status.app_missing?.length ? 'primary' : undefined}>
            <Icon id="bi-box-arrow-up-right" /> {status.kind === 'app' ? 'Edit permissions on GitHub' : 'Edit the token on GitHub'}
          </a>
        ) : null}
        {status.install_url ? (
          <a class="t-btn" data-size="sm" href={status.install_url} target="_blank" rel="noopener" data-variant={gaps && !status.app_missing?.length ? 'primary' : undefined} data-tip="New permissions take effect once the installation accepts them">
            <Icon id="bi-box-arrow-up-right" /> Accept on the installation
          </a>
        ) : null}
        {status.new_install_url ? (
          <a class="t-btn" data-size="sm" data-variant="ghost" href={status.new_install_url} target="_blank" rel="noopener">
            <Icon id="bi-plus-lg" /> Install on another account
          </a>
        ) : null}
      </div>
    </div>
  )
}

export const AppCreatedAlert = ({ result }: { result: AppCreatedView }) =>
  result.ok ? (
    <div class="t-alert" data-tone="success" role="status" id="app-created" data-toast={`GitHub App ${result.slug} created and stored`}>
      <Icon id="bi-check-circle" />
      <div class="t-alert-body">
        <b safe>{`GitHub App ${result.slug} created.`}</b> Its ID, private key and webhook secret are stored and the credential mode is GitHub App. Install it on the accounts whose repos octowarden manages.
      </div>
      <div class="t-alert-actions">
        <a class="t-btn" data-size="sm" data-variant="primary" href={result.install_url} target="_blank" rel="noopener">
          <Icon id="bi-box-arrow-up-right" /> Install the App
        </a>
      </div>
    </div>
  ) : (
    <div class="t-alert" data-tone="danger" role="alert" id="app-created" data-toast-error={result.message}>
      <Icon id="bi-exclamation-triangle" />
      <div class="t-alert-body">
        <b>The App was not stored:</b> <span safe>{result.message}</span>
      </div>
    </div>
  )

/** The App manifest with a copy button and the form that creates the App on GitHub (personal or organization). */
export const ManifestBlock = ({ manifest }: { manifest: ManifestView }) => (
  <details class="t-card" data-variant="collapsible" id="github-manifest" open={!manifest.configured}>
    <summary class="t-card-header">
      <h3 class="t-card-title">
        <Icon id="bi-file-earmark-code" />
        App manifest
      </h3>
    </summary>
    <div class="t-card-body t-stack" data-gap="3">
      <p>
        {manifest.configured ? 'A GitHub App is configured. ' : 'No GitHub App is configured. '}
        GitHub creates an App with exactly the permissions below from this manifest; the App ID, private key and webhook secret come back here and are stored. Octoforge can also create and
        deliver it.
      </p>
      <form class="t-cluster" data-gap="2" data-align="center" method="post" action={`https://github.com/settings/apps/new?state=${manifest.state}`} id="manifest-form" data-state={manifest.state}>
        <input type="hidden" name="manifest" value={manifest.json} />
        {manifest.orgs.length ? (
          <select class="t-select" data-size="sm" id="manifest-owner" aria-label="Create the App under">
            <option value="" selected safe>
              {manifest.login ? `${manifest.login} (personal account)` : 'Personal account'}
            </option>
            {manifest.orgs.map((o) => (
              <option value={o} safe>
                {`${o} (organization)`}
              </option>
            ))}
          </select>
        ) : null}
        <button class="t-btn" type="submit" data-size="sm" data-variant={manifest.configured ? undefined : 'primary'}>
          <Icon id="bi-github" /> Create the App on GitHub
        </button>
      </form>
      <pre class="t-code-pre" data-variant="json" id="manifest-json">
        <button class="t-code-copy" type="button" aria-label="Copy">
          ⧉
        </button>
        {e(manifest.json)}
      </pre>
      <p class="t-small t-muted">
        Manual steps and the permission table:{' '}
        <a href="https://github.com/rojosinalma/octowarden/blob/main/docs/github-app.md" target="_blank" rel="noopener">
          docs/github-app.md
        </a>
        .
      </p>
    </div>
  </details>
)
