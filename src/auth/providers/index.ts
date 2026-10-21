import { UnavailableError } from '../../lib/json'
import { getSetting } from '../../lib/settings'
import type { GitHubClient } from '../../github/client'
import type { AuthMode, AuthProvider, AuthStatus } from '../types'
import { app } from './app'
import { gh } from './gh'
import { pat } from './pat'

/** One line per provider. */
export const PROVIDERS: Partial<Record<AuthMode, AuthProvider>> = {
  app,
  pat,
  gh,
}

/** Order tried when `github_auth_mode` is `auto`: an App (delivered or in settings) → PAT → gh CLI. */
export const AUTO_ORDER: readonly AuthMode[] = ['app', 'pat', 'gh']

export function getProvider(name: AuthMode): AuthProvider | undefined {
  return PROVIDERS[name]
}

export function listProviders(): AuthProvider[] {
  return AUTO_ORDER.map((n) => PROVIDERS[n]).filter((p): p is AuthProvider => p !== undefined)
}

let override: GitHubClient | undefined

/** Tests and the standalone CLI: force a client (undefined restores normal resolution). */
export function setGitHubClient(client: GitHubClient | undefined): void {
  override = client
}

/** The provider that serves now, honouring `github_auth_mode`; undefined when none has credentials. */
export async function resolveAuth(): Promise<AuthProvider | undefined> {
  const mode = await getSetting('github_auth_mode')
  const order = mode === 'auto' ? AUTO_ORDER : [mode as AuthMode]
  for (const name of order) {
    const p = PROVIDERS[name]
    if (p && (await p.available())) return p
  }
  return undefined
}

/** Client of the resolved provider; throws UnavailableError (503) with a reason when none is configured. */
export async function githubClient(): Promise<GitHubClient> {
  if (override) return override
  const p = await resolveAuth()
  if (!p) {
    const mode = await getSetting('github_auth_mode')
    throw new UnavailableError(
      mode === 'auto' ? 'no GitHub credentials: set a token or a GitHub App in Settings' : `GitHub auth mode ${mode} has no credentials`,
    )
  }
  return p.client()
}

/** For /health and status answers; never throws, never returns a secret. */
export async function authStatus(): Promise<AuthStatus> {
  if (override) return { mode: override.mode as AuthMode, source: 'settings' }
  try {
    const p = await resolveAuth()
    if (!p) return { mode: 'none', source: 'none' }
    return { mode: p.name, source: await p.source(), ...(await p.identity()) }
  } catch {
    return { mode: 'none', source: 'none' }
  }
}
