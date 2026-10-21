import { appCredentials, appJwtClient, installationClient } from '../auth/providers/app'
import { forcedGitHubClient, resolveAuth } from '../auth/providers'
import type { AuthMode, CredentialSource } from '../auth/types'
import { bus } from '../lib/bus'
import { log } from '../lib/log'
import { getSetting, getSettingInt, type SettingKey } from '../lib/settings'
import { GitHubError, type GitHubClient } from './client'
import {
  CLASSIC_SCOPES,
  lowestGrants,
  missingGrants,
  permId,
  permissionState,
  REQUIRED_PERMISSIONS,
  scopeState,
  type ClassicScope,
  type GrantedLevel,
  type PermissionLevel,
  type RequiredPermission,
} from './permissions'

const logger = log.child('github')
const PROBE_TIMEOUT_MS = 10_000
/** Most installations probed (each one may cost one repo-count call). */
export const MAX_STATUS_INSTALLATIONS = 50

export type PermissionRow = {
  key: string
  level: PermissionLevel
  granted: GrantedLevel
  /** true = satisfied, false = definitely missing, null = cannot tell. */
  ok: boolean | null
  /** An alternative permission that satisfies this row (`pull_requests:write` for labels). */
  via?: string
  /** Why the row counts as satisfied without a grant (an organization permission with no organization installed). */
  note?: string
  why: string
  breaks: string
  sections: string[]
  features?: string[]
  /** The classic token scope that grants the same access. */
  scope: ClassicScope
}

export type ScopeRow = { key: ClassicScope; ok: boolean | null; why: string; breaks: string }

export type InstallationStatus = {
  id: number
  account: string
  type: 'user' | 'org'
  repository_selection?: string
  repo_count?: number
  /** Definite gaps on this installation (`<key>:<level>`). */
  missing: string[]
  /** Where the account owner reviews and accepts the installation's permissions. */
  url: string
}

export type GitHubStatus = {
  /** A credential answers and nothing required is definitely missing. */
  ok: boolean
  mode: AuthMode | 'none' | 'fake'
  source: CredentialSource
  /** The credential came from Octoforge (PUT /api/octoforge/github). */
  delivered: boolean
  /** Token: `pat-classic` (scopes known) or `pat-fine-grained` (grants unknown); App: `app`. */
  kind?: 'app' | 'pat-classic' | 'pat-fine-grained'
  /** GitHub login (token) or App slug. */
  identity?: string
  app_slug?: string
  /** The App's settings page. */
  app_url?: string
  /** Where the App's (or token's) permissions are edited. */
  permissions_url?: string
  /** The installation to review (pinned one, else the first with gaps, else the only one). */
  install_url?: string
  /** Install the App on another account. */
  new_install_url?: string
  installations?: InstallationStatus[]
  /** The installation pinned by `github_app_installation_id`; its grants fill the rows. */
  installation_id?: number
  /** Permissions the App itself does not request (fix on the App first, then accept on each installation). */
  app_missing?: string[]
  permissions: PermissionRow[]
  /** Classic token: what each scope covers and whether the token has it. */
  scopes?: ScopeRow[]
  granted_scopes?: string[]
  /** Definite gaps, `<key>:<level>` (permissions) — rows with ok === false. */
  missing: string[]
  /** Classic token: scopes it definitely lacks. */
  missing_scopes?: string[]
  note?: string
  checked_at: string
  /** GitHub could not be asked; every row is then unknown and `missing` empty. */
  error?: string
}

type AppClients = { jwt: GitHubClient; installation(id: number): GitHubClient }
type AppFactory = (appId: string, privateKey: string) => AppClients

const realFactory: AppFactory = (appId, privateKey) => ({ jwt: appJwtClient(appId, privateKey), installation: (id) => installationClient(appId, privateKey, id) })
let appFactory: AppFactory = realFactory

/** Tests: replace the App clients the probe uses (undefined restores the real ones). */
export function setStatusAppFactory(fn: AppFactory | undefined): void {
  appFactory = fn ?? realFactory
}

const unknownRows = (): PermissionRow[] => REQUIRED_PERMISSIONS.map((p) => row(p, 'unknown', null))

function row(p: RequiredPermission, granted: GrantedLevel, ok: boolean | null, via?: string): PermissionRow {
  return { key: p.key, level: p.level, granted, ok, ...(via ? { via } : {}), why: p.why, breaks: p.breaks, sections: p.sections, ...(p.features ? { features: p.features } : {}), scope: p.scope }
}

function rowsFor(granted: Record<string, string> | undefined): PermissionRow[] {
  return REQUIRED_PERMISSIONS.map((p) => {
    const s = permissionState(granted, p)
    return row(p, s.granted, s.ok, s.via)
  })
}

/** Where the account's owner reviews one installation and accepts new permissions. */
export function installationUrl(i: { id: number; account?: string; type?: string }): string {
  return i.type === 'org' && i.account ? `https://github.com/organizations/${i.account}/settings/installations/${i.id}` : `https://github.com/settings/installations/${i.id}`
}

/** The App's settings page (owner decides: personal or organization developer settings). */
export function appSettingsUrl(slug: string, owner?: { login?: string; type?: string }): string {
  return owner?.type === 'Organization' && owner.login ? `https://github.com/organizations/${owner.login}/settings/apps/${slug}` : `https://github.com/settings/apps/${slug}`
}

const reasonOf = (err: unknown) => (err instanceof GitHubError && err.status ? `${err.message} (HTTP ${err.status})` : (err as Error)?.message || String(err))

function base(mode: GitHubStatus['mode'], source: CredentialSource, delivered: boolean): GitHubStatus {
  return { ok: false, mode, source, delivered, permissions: unknownRows(), missing: [], checked_at: new Date().toISOString() }
}

function finish(s: GitHubStatus): GitHubStatus {
  s.missing = s.permissions.filter((p) => p.ok === false).map(permId)
  if (s.scopes) s.missing_scopes = s.scopes.filter((x) => x.ok === false).map((x) => x.key)
  s.ok = !s.error && s.mode !== 'none' && s.missing.length === 0 && !s.missing_scopes?.length && (!s.installations || s.installations.length > 0)
  return s
}

type RawInstallation = { id: number; account?: { login?: string; type?: string } | null; permissions?: Record<string, string>; repository_selection?: string }

async function probeApp(s: GitHubStatus, clients: AppClients, pinned: string | undefined): Promise<void> {
  s.kind = 'app'
  const { data: app } = await clients.jwt.request<{ slug?: string; owner?: { login?: string; type?: string }; permissions?: Record<string, string> }>('GET /app')
  if (app.slug) {
    s.app_slug = app.slug
    s.identity = app.slug
    s.app_url = appSettingsUrl(app.slug, app.owner ?? undefined)
    s.permissions_url = `${s.app_url}/permissions`
    s.new_install_url = `https://github.com/apps/${app.slug}/installations/new`
  }
  if (app.permissions) s.app_missing = missingGrants(app.permissions)
  const list = await clients.jwt.paginate<RawInstallation>('GET /app/installations', {}, MAX_STATUS_INSTALLATIONS)
  const installs: InstallationStatus[] = list
    .filter((i) => typeof i.id === 'number')
    .map((i) => {
      const type = i.account?.type === 'Organization' ? ('org' as const) : ('user' as const)
      const account = i.account?.login ?? 'unknown account'
      return { id: i.id, account, type, ...(i.repository_selection ? { repository_selection: i.repository_selection } : {}), missing: missingGrants(i.permissions ?? {}, type), url: installationUrl({ id: i.id, account, type }) }
    })
    .sort((a, b) => a.account.localeCompare(b.account))
  const grants = new Map(list.map((i) => [i.id, i.permissions ?? {}]))
  // Repo count: one cheap call (per_page 1, total_count) per selected-repos installation; "all" needs none.
  await Promise.all(
    installs.map(async (i) => {
      if (i.repository_selection === 'all') return
      try {
        const { data } = await clients.installation(i.id).request<{ total_count?: number }>('GET /installation/repositories', { per_page: 1 })
        if (typeof data.total_count === 'number') i.repo_count = data.total_count
      } catch (err) {
        logger.debug(`installation ${i.id}: repo count unknown: ${reasonOf(err)}`)
      }
    }),
  )
  s.installations = installs
  const pin = pinned ? installs.find((i) => String(i.id) === pinned) : undefined
  if (pin) s.installation_id = pin.id
  if (pinned && !pin) s.note = `Installation ${pinned} (setting github_app_installation_id) is not an installation of this App.`
  if (!installs.length) s.note = 'The App is installed on no account yet. Install it, then press Re-check.'
  // Pinned: every call uses that installation. Otherwise the lowest level across installations (a gap anywhere shows).
  const granted = pin ? grants.get(pin.id) : installs.length ? lowestGrants(installs.map((i) => grants.get(i.id) ?? {})) : undefined
  s.permissions = rowsFor(granted)
  // Organization permissions only count on organization installations; personal accounts can never grant them.
  const orgs = pin ? (pin.type === 'org' ? [pin] : []) : installs.filter((i) => i.type === 'org')
  const orgGranted = orgs.length ? lowestGrants(orgs.map((i) => grants.get(i.id) ?? {})) : undefined
  s.permissions = s.permissions.map((r) => {
    const p = REQUIRED_PERMISSIONS.find((x) => x.key === r.key && x.level === r.level)
    if (!p?.orgOnly || !installs.length) return r
    if (!orgGranted) return { ...r, ok: true, note: 'organization permission: no organization installation' }
    const st = permissionState(orgGranted, p)
    return { ...r, granted: st.granted, ok: st.ok, ...(st.via ? { via: st.via } : {}) }
  })
  const review = pin ?? installs.find((i) => i.missing.length) ?? (installs.length === 1 ? installs[0] : undefined)
  if (review) s.install_url = review.url
}

async function probeToken(s: GitHubStatus, gh: GitHubClient): Promise<void> {
  const res = await gh.request<{ login?: string }>('GET /user')
  if (res.data?.login) s.identity = res.data.login
  const header = res.headers['x-oauth-scopes']
  if (header === undefined) {
    s.kind = 'pat-fine-grained'
    s.permissions_url = 'https://github.com/settings/personal-access-tokens'
    s.note = 'GitHub does not report what a fine-grained token grants: the rows stay unknown and nothing is skipped. Compare the token with the table.'
    return
  }
  s.kind = 'pat-classic'
  const scopes = String(header)
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
  s.granted_scopes = scopes
  s.permissions_url = 'https://github.com/settings/tokens'
  s.scopes = CLASSIC_SCOPES.map((c) => ({ key: c.key, ok: scopeState(scopes, c.key), why: c.why, breaks: c.breaks }))
  s.permissions = REQUIRED_PERMISSIONS.map((p) => {
    const ok = scopeState(scopes, p.scope)
    return row(p, ok === null ? 'unknown' : ok ? p.level : 'none', ok)
  })
  if (s.mode === 'gh') s.note = `Add scopes to the gh login with: gh auth refresh -s ${CLASSIC_SCOPES.map((c) => c.key).join(',')}`
}

/** Asks GitHub what the active credential grants. Never throws. */
export async function probeGitHubStatus(): Promise<GitHubStatus> {
  const delivered = (await getSetting('github_credential_source').catch(() => '')) === 'octoforge'
  const forced = forcedGitHubClient()
  let s: GitHubStatus
  let run: () => Promise<void>
  try {
    if (forced) {
      s = base(forced.mode as GitHubStatus['mode'], delivered ? 'octoforge' : 'settings', delivered)
      run = forced.mode === 'app' ? () => probeApp(s, { jwt: forced, installation: () => forced }, undefined) : () => probeToken(s, forced)
    } else {
      const p = await resolveAuth()
      if (!p) {
        const none = base('none', 'none', false)
        none.note = 'No GitHub credential is configured: create a GitHub App below, or set a token.'
        return finish(none)
      }
      const source = await p.source()
      s = base(p.name, source, source === 'octoforge')
      if (p.name === 'app') {
        const creds = await appCredentials()
        if (!creds) throw new Error('GitHub App credentials disappeared')
        run = () => probeApp(s, appFactory(creds.appId, creds.privateKey), creds.installationId)
      } else {
        const gh = await p.client()
        run = () => probeToken(s, gh)
      }
    }
  } catch (err) {
    const failed = base('none', 'none', delivered)
    failed.error = reasonOf(err)
    return finish(failed)
  }
  let timer: Timer | undefined
  try {
    await Promise.race([run(), new Promise((_, reject) => (timer = setTimeout(() => reject(new Error(`GitHub did not answer within ${PROBE_TIMEOUT_MS / 1000} s`)), PROBE_TIMEOUT_MS)))])
  } catch (err) {
    logger.warn(`GitHub access check failed: ${reasonOf(err)}`)
    s.error = reasonOf(err)
    s.permissions = unknownRows()
    delete s.scopes
    delete s.installations
    delete s.app_missing
  } finally {
    clearTimeout(timer)
  }
  return finish(s)
}

/* ── Cache ──────────────────────────────────────────────────────────────────── */

const CREDENTIAL_KEYS = new Set(['github_auth_mode', 'github_token', 'github_app_id', 'github_app_private_key', 'github_app_installation_id', 'github_credential_source'])
let cache: { status: GitHubStatus; at: number; client: GitHubClient | undefined; fingerprint: string } | undefined
let inFlight: Promise<GitHubStatus> | undefined
let generation = 0
let unwatch: (() => void) | undefined

/** Drops the cached status: the next call asks GitHub. */
export function invalidateGitHubStatus(): void {
  cache = undefined
  generation++
}

/** (Re)subscribes cache invalidation to credential changes on the settings bus; called when the app is built. */
export function watchGitHubStatus(): void {
  unwatch?.()
  unwatch = bus.subscribe('settings', ({ key }) => {
    if (CREDENTIAL_KEYS.has(key)) invalidateGitHubStatus()
  })
}

/**
 * The GitHub access status, cached for `github_status_ttl_min` minutes; `refresh` asks GitHub now.
 * Dropped when a credential setting changes or the forced client changes. Never throws.
 */
export async function githubStatus(opts: { refresh?: boolean } = {}): Promise<GitHubStatus> {
  const forced = forcedGitHubClient()
  const [ttlMin, fingerprint] = await Promise.all([getSettingInt('github_status_ttl_min').catch(() => 10), credentialFingerprint()])
  if (!opts.refresh && cache && cache.client === forced && cache.fingerprint === fingerprint && Date.now() - cache.at < ttlMin * 60_000) return cache.status
  if (opts.refresh || cache) invalidateGitHubStatus()
  const gen = generation
  inFlight ??= probeGitHubStatus().finally(() => (inFlight = undefined))
  const status = await inFlight
  if (gen === generation) cache = { status, at: Date.now(), client: forced, fingerprint }
  return status
}

/** Hash of the credential settings: a change the bus did not report (another process, tests) still drops the cache. */
async function credentialFingerprint(): Promise<string> {
  const values = await Promise.all([...CREDENTIAL_KEYS].map((k) => getSetting(k as SettingKey).catch(() => '')))
  return new Bun.CryptoHasher('sha256').update(values.join('\0')).digest('hex')
}

/** The cached status without asking GitHub, whatever its age (undefined when there is none). */
export function peekGitHubStatus(): GitHubStatus | undefined {
  return cache?.client === forcedGitHubClient() ? cache?.status : undefined
}

/* ── Gates for the engine and the octoforge contract ───────────────────────── */

export type Gap = { permission: RequiredPermission; reason: string }

/** Definite gaps that apply to a repo of `owner`: its installation's when the App has one there, else the status rows. */
export function gapsFor(status: GitHubStatus, owner: string): Gap[] {
  const inst = status.installation_id === undefined ? status.installations?.find((i) => i.account.toLowerCase() === owner.toLowerCase()) : undefined
  const missing = new Set(inst ? inst.missing : status.missing)
  const classic = status.kind === 'pat-classic'
  return REQUIRED_PERMISSIONS.filter((p) => missing.has(permId(p))).map((p) => ({
    permission: p,
    reason: classic ? `token lacks scope ${p.scope}` : `GitHub App lacks ${permId(p)}`,
  }))
}

/** Octoforge contract v1 `/status` → `github.missing` (definite gaps only), `permissions_url`, `install_url`. */
export function contractPermissions(status: GitHubStatus): { missing: string[]; permissions_url?: string; install_url?: string } {
  return {
    missing: status.missing,
    ...(status.permissions_url ? { permissions_url: status.permissions_url } : {}),
    ...(status.install_url ? { install_url: status.install_url } : {}),
  }
}
