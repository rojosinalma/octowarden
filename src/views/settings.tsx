import type { GitHubStatus } from '../github/status'
import { AppCreatedAlert, GitHubAccess, GitHubStateBadge, ManifestBlock, type AppCreatedView, type ManifestView } from './github'
import { Help, Icon, PageHeader, RelTime } from './parts'
import type { AuthView } from './types'

type Control =
  | { kind: 'duration'; scale?: number }
  | { kind: 'number'; min?: number; max?: number; unit?: string }
  | { kind: 'select'; options: { value: string; label: string; help?: string }[]; other?: boolean }
  | { kind: 'switch' }
  | { kind: 'secret'; multiline?: boolean; placeholder?: string }
  | { kind: 'text'; placeholder?: string; pattern?: string }
  | { kind: 'installation' }

export type Spec = { key: string; label: string; help: string; tone?: 'accent' | 'info' | 'danger'; control: Control }
type Group = { id: string; title: string; icon: string; items: Spec[] }

export const ACTOR_HEADERS = ['remote-user', 'x-authentik-username', 'x-forwarded-user', 'x-forwarded-email', 'x-auth-request-user', 'x-remote-user']

export const SETTING_GROUPS = (owners: string[]): Group[] => [
  {
    id: 'github',
    title: 'GitHub',
    icon: 'bi-github',
    items: [
      {
        key: 'github_auth_mode',
        label: 'Credential',
        help: 'Which GitHub credential octowarden uses. Automatic tries a GitHub App first, then a token, then the gh CLI login.',
        tone: 'accent',
        control: {
          kind: 'select',
          options: [
            { value: 'auto', label: 'Automatic', help: 'App → token → gh CLI, first one configured' },
            { value: 'app', label: 'GitHub App', help: 'installation token from the App below' },
            { value: 'pat', label: 'Personal access token', help: 'the token below or GITHUB_TOKEN' },
            { value: 'gh', label: 'gh CLI login', help: 'the token of `gh auth token` on this host' },
          ],
        },
      },
      {
        key: 'github_token',
        label: 'Personal access token',
        help: 'Fine-grained or classic token. The permission table above lists what it needs; a classic token needs repo, admin:repo_hook, delete_repo, workflow and read:org.',
        tone: 'danger',
        control: { kind: 'secret', placeholder: 'github_pat_…' },
      },
      { key: 'github_app_id', label: 'App ID', help: 'Shown on the App settings page under "About".', control: { kind: 'text', pattern: '[0-9]*' } },
      {
        key: 'github_app_installation_id',
        label: 'Installation ID',
        help: 'The installation the App acts as. Auto looks up the installation of each repo owner; pick one to pin it. The list comes from GitHub once App ID and private key are set.',
        control: { kind: 'installation' },
      },
      {
        key: 'github_app_private_key',
        label: 'App private key',
        help: 'The PEM file generated on the App settings page. Stored in the database; never shown again.',
        tone: 'danger',
        control: { kind: 'secret', multiline: true, placeholder: '-----BEGIN RSA PRIVATE KEY-----' },
      },
      {
        key: 'github_webhook_secret',
        label: 'Webhook secret',
        help: 'Templates refer to it by name; it is sent to GitHub with each webhook they create and never exported.',
        tone: 'danger',
        control: { kind: 'secret' },
      },
      {
        key: 'default_owner',
        label: 'Default owner',
        help: 'Owner preselected when you create a repo. Empty: the credential’s own account.',
        control: { kind: 'select', options: [{ value: '', label: 'The credential’s account' }, ...owners.map((o) => ({ value: o, label: o }))], other: true },
      },
      {
        key: 'public_url',
        label: 'Public URL',
        help: 'The address browsers use to reach octowarden; GitHub sends you back here after creating the App. Empty: the address of the page you are on.',
        control: { kind: 'text', placeholder: 'https://octowarden.example.com' },
      },
      {
        key: 'github_status_ttl_min',
        label: 'Re-check access every',
        help: 'How long the granted permissions are reused before GitHub is asked again. A credential change or Re-check asks at once.',
        control: { kind: 'duration', scale: 60 },
      },
      { key: 'github_concurrency', label: 'Parallel GitHub work', help: 'Repos planned, applied or audited at the same time in bulk runs.', control: { kind: 'number', min: 1, max: 32, unit: 'repos' } },
    ],
  },
  {
    id: 'audit',
    title: 'Drift audit',
    icon: 'bi-shield-check',
    items: [
      { key: 'audit_interval_min', label: 'Audit every', help: 'How often every repo with assigned sets is compared with its sets.', control: { kind: 'duration', scale: 60 } },
      { key: 'audit_jitter_s', label: 'Random delay', help: 'Up to this much is added to each start so runs do not hit GitHub at the same second.', control: { kind: 'duration' } },
      { key: 'audit_retention_days', label: 'Keep events for', help: 'Audit events older than this are purged by the scheduler.', control: { kind: 'number', min: 1, unit: 'days' } },
    ],
  },
  {
    id: 'notify',
    title: 'Notifications',
    icon: 'bi-bell',
    items: [
      {
        key: 'notify_discord_webhook',
        label: 'Discord webhook URL',
        help: 'Channel settings → Integrations → Webhooks → Copy URL. Must be https.',
        tone: 'danger',
        control: { kind: 'secret', placeholder: 'https://discord.com/api/webhooks/…' },
      },
      { key: 'notify_on_drift', label: 'Notify on drift', help: 'One message when a repo starts to drift from its sets.', control: { kind: 'switch' } },
      { key: 'notify_on_apply_fail', label: 'Notify on failed applies', help: 'One message per apply with failed changes.', control: { kind: 'switch' } },
    ],
  },
  {
    id: 'interface',
    title: 'Interface',
    icon: 'bi-person',
    items: [
      {
        key: 'ui_actor_header',
        label: 'User header',
        help: 'Request header your reverse proxy sets to the signed-in user; the audit trail records it as "who". Without it, UI actions show as "ui".',
        tone: 'accent',
        control: { kind: 'select', options: ACTOR_HEADERS.map((h) => ({ value: h, label: h })), other: true },
      },
      { key: 'sse_max_clients', label: 'Max live connections', help: 'Browsers and agents listening to live updates at once; more get 503.', control: { kind: 'number', min: 1, unit: 'clients' } },
      { key: 'sse_idle_s', label: 'Idle disconnect', help: 'A live stream with nothing to send for this long closes; the page reconnects on its own.', control: { kind: 'duration' } },
      {
        key: 'log_level',
        label: 'Log level',
        help: 'Applies within a few seconds; no restart.',
        control: {
          kind: 'select',
          options: [
            { value: 'debug', label: 'Debug', help: 'every GitHub call and decision' },
            { value: 'info', label: 'Info', help: 'normal operation' },
            { value: 'warn', label: 'Warning', help: 'only things that need a look' },
            { value: 'error', label: 'Error', help: 'only failures' },
          ],
        },
      },
    ],
  },
  {
    id: 'limits',
    title: 'Limits',
    icon: 'bi-box-seam',
    items: [
      { key: 'repos_refresh_max', label: 'Repos per refresh', help: 'Most repos read from GitHub when the repo list refreshes.', control: { kind: 'number', min: 1, unit: 'repos' } },
      { key: 'bulk_max_repos', label: 'Repos per bulk run', help: 'Most repos one bulk plan, apply or audit may hold.', control: { kind: 'number', min: 1, unit: 'repos' } },
      { key: 'plan_ttl_min', label: 'Plans expire after', help: 'An unapplied plan is dropped after this long; plan again to apply.', control: { kind: 'duration', scale: 60 } },
    ],
  },
]

const ControlFor = ({ spec, value, appReady }: { spec: Spec; value: string; appReady: boolean }) => {
  const id = `s-${spec.key}`
  const c = spec.control
  switch (c.kind) {
    case 'duration': {
      const seconds = Math.round((Number(value) || 0) * (c.scale ?? 1))
      return (
        <div class="t-input-group t-duration" data-setting={spec.key} data-value={String(seconds)} data-scale={c.scale ? String(c.scale) : undefined} data-size="sm">
          <input class="t-input" type="number" min="0" step="1" id={id} aria-label={spec.label} />
          <select class="t-select" aria-label="unit">
            <option value="1">s</option>
            <option value="60">min</option>
            <option value="3600">h</option>
          </select>
        </div>
      )
    }
    case 'number':
      return (
        <div class="t-input-group" data-size="sm">
          <input class="t-input" data-size="sm" type="number" min={c.min === undefined ? undefined : String(c.min)} max={c.max === undefined ? undefined : String(c.max)} step="1" id={id} data-setting={spec.key} value={value} />
          {c.unit ? <span class="t-input-addon">{c.unit}</span> : null}
        </div>
      )
    case 'select': {
      const known = c.options.some((o) => o.value === value)
      if (!c.other) {
        return (
          <select class="t-select" data-size="sm" id={id} data-setting={spec.key}>
            {c.options.map((o) => (
              <option value={o.value} selected={o.value === value} safe>
                {o.help ? `${o.label} — ${o.help}` : o.label}
              </option>
            ))}
          </select>
        )
      }
      // Known values are picked; "Other…" reveals a text field that carries the setting.
      return (
        <div class="t-stack" data-gap="1">
          <select class="t-select" data-size="sm" id={id} data-feeds={`${id}-value`} aria-label={spec.label}>
            {c.options.map((o) => (
              <option value={o.value} selected={known && o.value === value} safe>
                {o.label}
              </option>
            ))}
            <option value="__other" selected={!known}>
              Other…
            </option>
          </select>
          <input class="t-input" data-size="sm" id={`${id}-value`} data-setting={spec.key} value={value} aria-label={`${spec.label}: other value`} hidden={known} autocomplete="off" />
        </div>
      )
    }
    case 'switch':
      return (
        <label class="t-check" data-variant="switch">
          <input class="t-check-input" type="checkbox" role="switch" id={id} data-setting={spec.key} checked={value === 'true'} />
          <span class="t-check-label">{value === 'true' ? 'On' : 'Off'}</span>
        </label>
      )
    case 'secret': {
      const set = value === 'set'
      const placeholder = set ? 'Stored — type a new value to replace it' : (c.placeholder ?? 'Not set')
      return (
        <div class="t-stack" data-gap="1">
          {c.multiline ? (
            <textarea class="t-textarea t-mono" rows="3" id={id} data-setting={spec.key} data-secret placeholder={placeholder} spellcheck="false"></textarea>
          ) : (
            <div class="t-input-group" data-size="sm">
              <input class="t-input" data-size="sm" type="password" id={id} data-setting={spec.key} data-secret placeholder={placeholder} autocomplete="new-password" spellcheck="false" />
              <button class="t-btn" type="button" data-size="sm" data-icon="only" data-action="secret-reveal" data-for={id} aria-label={`Show ${spec.label}`} data-tip="Show while typing">
                <Icon id="bi-eye" />
              </button>
            </div>
          )}
          <div class="t-cluster" data-gap="2" data-align="center">
            <span class="t-badge" data-size="xs" data-tone={set ? 'success' : 'neutral'} data-secret-state={spec.key}>
              {set ? 'stored' : 'not set'}
            </span>
            <button class="t-btn" type="button" data-size="xs" data-variant="ghost" data-tone="danger" data-action="secret-clear" data-key={spec.key} data-label={spec.label} hidden={!set}>
              Clear
            </button>
          </div>
        </div>
      )
    }
    case 'installation':
      // Picked from GET /app/installations (loaded by public/app.js); the stored value stays selectable.
      return (
        <div class="t-stack" data-gap="1" data-installations data-value={value} data-app-ready={appReady ? 'true' : 'false'}>
          <select class="t-select" data-size="sm" id={id} data-feeds={`${id}-value`} aria-label={spec.label}>
            <option value="" selected={value === ''}>
              Auto: look up per repo owner
            </option>
            {value ? (
              <option value={value} selected safe>
                {`#${value} (stored)`}
              </option>
            ) : null}
          </select>
          <input class="t-input" data-size="sm" id={`${id}-value`} data-setting={spec.key} value={value} aria-label={`${spec.label} value`} hidden />
          <p class="t-small t-muted" data-role="installations-state" aria-live="polite">
            {appReady ? "Loading the App's installations…" : 'Set the App ID and the App private key to pick an installation.'}
          </p>
        </div>
      )
    case 'text':
      return <input class="t-input" data-size="sm" id={id} data-setting={spec.key} value={value} placeholder={c.placeholder} pattern={c.pattern} inputmode={c.pattern ? 'numeric' : undefined} autocomplete="off" />
  }
}

export const SettingRow = ({ spec, value, appReady = false }: { spec: Spec; value: string; appReady?: boolean }) => (
  <div class="t-setting" data-key={spec.key}>
    <div class="t-setting-label">
      <label for={`s-${spec.key}`} safe>
        {spec.label}
      </label>
      <Help label={spec.label} tone={spec.tone}>
        <p safe>{spec.help}</p>
      </Help>
    </div>
    <div class="t-setting-control">
      <ControlFor spec={spec} value={value} appReady={appReady} />
    </div>
    <span class="t-setting-state" aria-live="polite"></span>
  </div>
)

export const settingsSubnav = (owners: string[]) => [
  { href: '/settings#appearance', label: 'Appearance', icon: 'bi-palette' },
  ...SETTING_GROUPS(owners).map((g) => ({ href: `/settings#${g.id}`, label: g.title, icon: g.icon })),
  { href: '/settings#about', label: 'About', icon: 'bi-info-circle' },
]

export type SettingsData = {
  settings: Record<string, string>
  auth: AuthView
  owners: string[]
  version: string
  lastAuditAt?: string | null
  /** App ID and key are available (settings or env). */
  appReady?: boolean
  /** Required versus granted GitHub permissions. */
  github?: GitHubStatus
  manifest?: ManifestView
  /** Result of the App manifest callback, shown once. */
  appCreated?: AppCreatedView
}

export const SettingsPage = ({ settings, auth, owners, version, appReady = false, github, manifest, appCreated }: SettingsData) => {
  const delivered = settings['github_credential_source'] === 'octoforge' || auth.source === 'octoforge'
  const groups = SETTING_GROUPS(owners)
  return (
    <>
      <PageHeader title="Settings" lead="Every change saves on its own." />
      <div class="t-stack" data-gap="5" id="settings">
        <section class="t-section" id="appearance">
          <h2 class="t-section-title">Appearance</h2>
          <div class="t-section-body t-settings">
            <div class="t-setting" data-key="ui_theme">
              <div class="t-setting-label">
                <span id="theme-label">Skin and palette</span>
                <Help label="skin and palette">
                  <p>Stored as settings and shared by every browser. The sun/moon button in the footer switches between dark and light.</p>
                </Help>
              </div>
              <div class="t-setting-control">
                <div data-tailor-pickers="skin palette" aria-labelledby="theme-label"></div>
              </div>
              <span class="t-setting-state" aria-live="polite"></span>
            </div>
          </div>
        </section>
        {groups.map((g) => (
          <section class="t-section" id={g.id}>
            <h2 class="t-section-title">
              <span safe>{g.title}</span>
              {g.id === 'github' ? (
                <>
                  {' '}
                  {github ? (
                    <GitHubStateBadge status={github} id="github-state" />
                  ) : (
                    <span class="t-badge" data-tone={auth.mode === 'none' ? 'warning' : 'success'} id="github-state">
                      {auth.mode === 'none' ? 'not configured' : 'connected'}
                    </span>
                  )}
                  {delivered && !github?.delivered ? (
                    <>
                      {' '}
                      <span class="t-badge" data-tone="purple">
                        delivered by octoforge
                      </span>
                    </>
                  ) : null}
                </>
              ) : null}
            </h2>
            <div class="t-section-body t-stack" data-gap="3">
              {g.id === 'github' && appCreated ? <AppCreatedAlert result={appCreated} /> : null}
              {g.id === 'github' && github ? <GitHubAccess status={github} /> : null}
              {g.id === 'github' && manifest ? <ManifestBlock manifest={manifest} /> : null}
              <div class="t-settings">
                {g.items.map((spec) => (
                  <SettingRow spec={spec} value={settings[spec.key] ?? ''} appReady={appReady} />
                ))}
              </div>
            </div>
          </section>
        ))}
        <section class="t-section" id="about">
          <h2 class="t-section-title">About</h2>
          <div class="t-section-body">
            <dl class="t-facts">
              <dt>Version</dt>
              <dd class="t-mono" safe>
                {version}
              </dd>
              <dt>Source</dt>
              <dd>
                <a href="https://github.com/rojosinalma/octowarden" target="_blank" rel="noopener">
                  github.com/rojosinalma/octowarden
                </a>
              </dd>
              <dt>Page rendered</dt>
              <dd>
                <RelTime at={new Date().toISOString()} />
              </dd>
            </dl>
          </div>
        </section>
      </div>
    </>
  )
}
