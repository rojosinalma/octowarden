// GitHub access tests: core bootstrap (in-memory SQLite, fake GitHub) plus recorded App answers.
export { fresh, REPO, type World } from '../core/helpers'
import { setGitHubClient } from '../../src/auth/providers'
import { createFakeGitHub, fakeError, type FakeGitHub } from '../../src/github/fake'
import { setStatusAppFactory } from '../../src/github/status'
import { setSetting } from '../../src/lib/settings'

export async function fixture<T = any>(path: string): Promise<T> {
  return (await Bun.file(new URL(`../fixtures/${path}.json`, import.meta.url)).json()) as T
}

/** A key that only has to look like PEM: the App clients are fakes. */
export const FAKE_PEM = '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----'

export type AppWorld = { jwt: FakeGitHub; installations: Map<number, FakeGitHub> }

/**
 * App credentials in settings (mode app, no forced client) with fake JWT and installation clients serving the
 * recorded `GET /app` and `GET /app/installations`; `selected` installations answer a repo count.
 */
export async function appWorld(opts: { installations?: unknown[]; app?: unknown; installationId?: string; repoCount?: number; failApp?: boolean } = {}): Promise<AppWorld> {
  setGitHubClient(undefined)
  await setSetting('github_auth_mode', 'app')
  await setSetting('github_app_id', '1234567')
  await setSetting('github_app_private_key', FAKE_PEM)
  await setSetting('github_app_installation_id', opts.installationId ?? '')
  const jwt = createFakeGitHub('app')
  const app = opts.app ?? (await fixture('github/app'))
  const list = opts.installations ?? (await fixture('github/installations'))
  jwt.on('GET /app', () => {
    if (opts.failApp) throw fakeError(0, 'getaddrinfo ENOTFOUND api.github.com')
    return app
  })
  jwt.on('GET /app/installations', () => list)
  const installations = new Map<number, FakeGitHub>()
  setStatusAppFactory(() => ({
    jwt,
    installation(id) {
      let c = installations.get(id)
      if (!c) {
        c = createFakeGitHub('app')
        c.on('GET /installation/repositories', () => ({ total_count: opts.repoCount ?? 3, repositories: [] }))
        installations.set(id, c)
      }
      return c
    },
  }))
  return { jwt, installations }
}

/** Forced token client answering `GET /user`, with `x-oauth-scopes` when `scopes` is given (classic token). */
export function tokenClient(scopes?: string, mode = 'pat'): FakeGitHub {
  const gh = createFakeGitHub(mode)
  gh.on('GET /user', () => ({ login: 'tester' }), scopes === undefined ? undefined : { 'x-oauth-scopes': scopes })
  setGitHubClient(gh)
  return gh
}
