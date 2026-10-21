import { createAppAuth } from '@octokit/auth-app'
import { createGitHubClient, GitHubError, type GitHubClient, type RouteParams } from '../../github/client'
import { config, pem } from '../../lib/config'
import { log } from '../../lib/log'
import { getSetting } from '../../lib/settings'
import type { AuthProvider, CredentialSource, Identity } from '../types'

const logger = log.child('github')
const IDENTITY_TTL_MS = 5 * 60_000
const INSTALLATION_TTL_MS = 60 * 60_000
const MAX_INSTALLATIONS = 200
const MAX_CLIENTS = 50

export type AppCredentials = { appId: string; privateKey: string; installationId?: string; source: CredentialSource }

/** App id + key + optional installation id: settings first (where octoforge delivers them), then env. */
export async function appCredentials(): Promise<AppCredentials | undefined> {
  const id = await getSetting('github_app_id')
  const key = await getSetting('github_app_private_key')
  if (id && key) {
    const installationId = (await getSetting('github_app_installation_id')) || undefined
    const source = (await getSetting('github_credential_source')) === 'octoforge' ? 'octoforge' : 'settings'
    return { appId: id, privateKey: pem(key)!, installationId, source }
  }
  const c = config()
  if (c.githubAppId && c.githubAppPrivateKey) return { appId: c.githubAppId, privateKey: c.githubAppPrivateKey, installationId: c.githubAppInstallationId, source: 'env' }
  return undefined
}

/** Client that signs requests with the App JWT: only `/app/*` and installation lookups work with it. */
export function appJwtClient(appId: string, privateKey: string): GitHubClient {
  return createGitHubClient({ mode: 'app', authStrategy: createAppAuth, auth: { appId, privateKey } })
}

/** Client acting as one installation (installation tokens are minted and refreshed by @octokit/auth-app). */
export function installationClient(appId: string, privateKey: string, installationId: string | number): GitHubClient {
  return createGitHubClient({ mode: 'app', authStrategy: createAppAuth, auth: { appId, privateKey, installationId: Number(installationId) } })
}

/** Bounded insertion-order map: the oldest entry goes when full. */
function remember<K, V>(map: Map<K, V>, key: K, value: V, cap: number): V {
  map.delete(key)
  map.set(key, value)
  while (map.size > cap) map.delete(map.keys().next().value as K)
  return value
}

/** The account a call is about: `owner`/`username`/`org` params, or `repositoryNameWithOwner` in GraphQL input. */
export function ownerOf(params: RouteParams | undefined, depth = 0): string | undefined {
  if (!params || typeof params !== 'object' || depth > 4) return undefined
  for (const k of ['owner', 'username', 'org']) {
    const v = params[k]
    if (typeof v === 'string' && v) return v
  }
  const nwo = params.repositoryNameWithOwner
  if (typeof nwo === 'string' && nwo.includes('/')) return nwo.split('/')[0]
  for (const v of Object.values(params)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const found = ownerOf(v as RouteParams, depth + 1)
      if (found) return found
    }
  }
  return undefined
}

type State = {
  fingerprint: string
  creds: AppCredentials
  jwt: GitHubClient
  clients: Map<string, GitHubClient>
  installations: Map<string, { id: number; at: number }>
  only?: number
  client?: GitHubClient
  ident?: { value: Identity; at: number }
}

let state: State | undefined

function fingerprint(c: AppCredentials): string {
  return `${c.appId}:${c.installationId ?? ''}:${new Bun.CryptoHasher('sha256').update(c.privateKey).digest('hex')}`
}

async function current(): Promise<State> {
  const creds = await appCredentials()
  if (!creds) throw new Error('no GitHub App: set github_app_id and github_app_private_key in Settings, or GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY')
  const fp = fingerprint(creds)
  if (state?.fingerprint !== fp) {
    state = { fingerprint: fp, creds, jwt: appJwtClient(creds.appId, creds.privateKey), clients: new Map(), installations: new Map() }
  }
  return state
}

function clientFor(s: State, id: number): GitHubClient {
  const k = String(id)
  return s.clients.get(k) ?? remember(s.clients, k, installationClient(s.creds.appId, s.creds.privateKey, id), MAX_CLIENTS)
}

/** Installation id for an account; looked up with the JWT and cached (bounded, 1 h). */
async function installationFor(s: State, owner: string, repo?: unknown): Promise<number> {
  const k = owner.toLowerCase()
  const hit = s.installations.get(k)
  if (hit && Date.now() - hit.at < INSTALLATION_TTL_MS) return hit.id
  const tries: [string, RouteParams][] =
    typeof repo === 'string' && repo
      ? [['GET /repos/{owner}/{repo}/installation', { owner, repo }]]
      : [
          ['GET /users/{username}/installation', { username: owner }],
          ['GET /orgs/{org}/installation', { org: owner }],
        ]
  for (const [route, params] of tries) {
    try {
      const { data } = await s.jwt.request<{ id: number }>(route, params)
      return remember(s.installations, k, { id: data.id, at: Date.now() }, MAX_INSTALLATIONS).id
    } catch (err) {
      if (!(err instanceof GitHubError) || err.status !== 404) throw err
    }
  }
  throw new GitHubError(`the GitHub App is not installed on ${owner}`, 404, tries[0]![0])
}

/** Calls that name no account go to the App's only installation; several installations need the setting. */
async function onlyInstallation(s: State): Promise<number> {
  if (s.only !== undefined) return s.only
  const list = await s.jwt.paginate<{ id: number }>('GET /app/installations', {}, 100)
  if (list.length === 1) return (s.only = list[0]!.id)
  throw new GitHubError(
    list.length ? `the GitHub App has ${list.length} installations: set github_app_installation_id` : 'the GitHub App has no installations',
    404,
    'GET /app/installations',
  )
}

const APP_ROUTE = /^[A-Z]+ \/app(\/|$)/

/** Without an installation id: every call picks the installation of the account it touches. */
function routingClient(s: State): GitHubClient {
  const pick = async (route: string, params: RouteParams | undefined): Promise<GitHubClient> => {
    if (APP_ROUTE.test(route)) return s.jwt
    const owner = ownerOf(params)
    return clientFor(s, owner ? await installationFor(s, owner, params?.repo) : await onlyInstallation(s))
  }
  return {
    mode: 'app',
    request: async (route, params) => (await pick(route, params)).request(route, params),
    paginate: async (route, params, max) => (await pick(route, params)).paginate(route, params, max),
    graphql: async (query, variables) => (await pick('POST /graphql', variables)).graphql(query, variables),
  }
}

/** Drops cached clients and lookups (tests, credential change is detected anyway). */
export function resetAppCache(): void {
  state = undefined
}

/** GitHub App: installation tokens, delivered by octoforge or set in Settings/env. */
export const app: AuthProvider = {
  name: 'app',
  title: 'GitHub App',
  async available() {
    return (await appCredentials()) !== undefined
  },
  async client() {
    const s = await current()
    s.client ??= s.creds.installationId ? clientFor(s, Number(s.creds.installationId)) : routingClient(s)
    return s.client
  },
  async identity() {
    let s: State
    try {
      s = await current()
    } catch {
      return {}
    }
    if (s.ident && Date.now() - s.ident.at < IDENTITY_TTL_MS) return s.ident.value
    try {
      const { data } = await s.jwt.request<{ slug: string }>('GET /app')
      s.ident = { value: { app_slug: data.slug }, at: Date.now() }
      return s.ident.value
    } catch (err) {
      logger.warn(`GitHub App identity unknown: ${(err as Error).message}`)
      return {}
    }
  },
  async source() {
    return (await appCredentials())?.source ?? 'none'
  },
}
