import { githubClient } from '../auth/providers'
import { appCredentials } from '../auth/providers/app'
import { createGitHubClient, GitHubError, type GitHubClient } from '../github/client'
import { githubStatus as cachedStatus, invalidateGitHubStatus, type GitHubStatus } from '../github/status'
import { recordEvent } from '../lib/events'
import { AppError, ValidationError } from '../lib/json'
import { log } from '../lib/log'
import { setSetting } from '../lib/settings'
import type { Ctx } from './context'

const logger = log.child('github')

/** GitHub access: granted versus required permissions, links to fix them. Cached; `refresh` asks GitHub now. Never throws. */
export async function githubStatus(opts: { refresh?: boolean } = {}): Promise<GitHubStatus> {
  return cachedStatus(opts)
}

/** One-line summary of a status for toasts and API messages. */
export function statusMessage(s: GitHubStatus): string {
  if (s.error) return `GitHub check failed: ${s.error}`
  if (s.mode === 'none') return 'no GitHub credential configured'
  if (s.missing_scopes?.length) return `the token lacks ${s.missing_scopes.join(', ')}`
  if (s.missing.length) return `GitHub access lacks ${s.missing.join(', ')}`
  if (s.installations && !s.installations.length) return 'the GitHub App is installed on no account yet'
  if (s.kind === 'pat-fine-grained') return 'GitHub access checked: a fine-grained token does not report its permissions'
  return 'GitHub access checked: nothing missing'
}

/* ── App from manifest ─────────────────────────────────────────────────────── */

const STATE_TTL_MS = 60 * 60_000
const STATES_MAX = 50
const states = new Map<string, number>()

/** One-time `state` for the manifest form; the callback accepts each one once within an hour (max 50 open). */
export function manifestState(): string {
  const now = Date.now()
  for (const [k, at] of states) if (now - at > STATE_TTL_MS) states.delete(k)
  while (states.size >= STATES_MAX) states.delete(states.keys().next().value as string)
  const value = Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url')
  states.set(value, now)
  return value
}

function takeState(value: string | undefined): boolean {
  if (!value) return false
  const at = states.get(value)
  states.delete(value)
  return at !== undefined && Date.now() - at <= STATE_TTL_MS
}

type Conversion = { id: number; slug: string; pem: string; webhook_secret?: string | null; html_url?: string; owner?: { login?: string; type?: string } | null }

let conversionClient: () => GitHubClient = () => createGitHubClient({ mode: 'none' })

/** Tests: replace the unauthenticated client used for the manifest conversion (undefined restores it). */
export function setConversionClient(fn: (() => GitHubClient) | undefined): void {
  conversionClient = fn ?? (() => createGitHubClient({ mode: 'none' }))
}

export type CreatedApp = { app_id: number; slug: string; owner?: string; install_url: string; html_url?: string }

/**
 * Finishes "Create the App on GitHub": exchanges the one-time `code` (POST /app-manifests/{code}/conversions,
 * no auth), stores App ID, private key and webhook secret, switches `github_auth_mode` to `app`.
 * `state` must be one this instance handed out. The event names the App, never a secret.
 */
export async function convertManifest(code: string | undefined, state: string | undefined, ctx: Ctx): Promise<CreatedApp> {
  if (!code || !/^[A-Za-z0-9_-]{1,100}$/.test(code)) throw new ValidationError('GitHub sent no valid code: start "Create the App on GitHub" again')
  if (!takeState(state)) throw new ValidationError('this App creation was not started here or is older than an hour: start "Create the App on GitHub" again')
  let data: Conversion
  try {
    data = (await conversionClient().request<Conversion>('POST /app-manifests/{code}/conversions', { code })).data
  } catch (err) {
    const status = err instanceof GitHubError ? err.status : 0
    throw new AppError(`GitHub refused the App conversion${status ? ` (HTTP ${status})` : ''}: ${(err as Error).message}`, 502, 'upstream')
  }
  if (!data || typeof data.id !== 'number' || !data.pem || !data.slug) throw new AppError('GitHub answered the App conversion without an id, slug or key', 502, 'upstream')
  await setSetting('github_app_id', String(data.id))
  await setSetting('github_app_private_key', data.pem)
  await setSetting('github_webhook_secret', data.webhook_secret ?? '')
  await setSetting('github_app_installation_id', '')
  await setSetting('github_credential_source', '')
  await setSetting('github_auth_mode', 'app')
  invalidateGitHubStatus()
  const install_url = `https://github.com/apps/${data.slug}/installations/new`
  logger.info(`GitHub App ${data.slug} (${data.id}) created from the manifest and stored`)
  await recordEvent({ actor: ctx.actor, source: ctx.source, action: 'github.app.create', outcome: 'info', message: `GitHub App ${data.slug} created from the manifest; credential mode set to app` })
  return { app_id: data.id, slug: data.slug, owner: data.owner?.login, install_url, html_url: data.html_url }
}

const ORGS_MAX = 100

/**
 * Organizations the active token belongs to, for the manifest form's owner picker. Empty for an App, without a
 * credential, or when GitHub refuses (no read:org): the personal path still works.
 */
export async function manifestOwners(): Promise<{ login?: string; orgs: string[] }> {
  try {
    const gh = await githubClient()
    if (gh.mode === 'app') return { orgs: [] }
    const [me, orgs] = await Promise.all([
      gh.request<{ login?: string }>('GET /user').then((r) => r.data.login),
      gh.paginate<{ login: string }>('GET /user/orgs', {}, ORGS_MAX).then((l) => l.map((o) => o.login).filter(Boolean)),
    ])
    return { login: me, orgs: orgs.sort((a, b) => a.localeCompare(b)) }
  } catch {
    return { orgs: [] }
  }
}

/** True when settings or env hold App credentials (the manifest block then collapses). */
export async function appConfigured(): Promise<boolean> {
  return (await appCredentials().catch(() => undefined)) !== undefined
}
