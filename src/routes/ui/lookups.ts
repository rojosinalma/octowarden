import { appCredentials, appJwtClient } from '../../auth/providers/app'
import { GitHubError, type GitHubClient } from '../../github/client'
import { AppError, UnavailableError } from '../../lib/json'
import * as svc from '../../services'
import type { Lookups } from '../../views/types'

export type InstallationOption = { id: number; account: string; type: string }

let jwtFactory: (appId: string, privateKey: string) => GitHubClient = appJwtClient

/** Tests: replace the App JWT client (undefined restores the real one). */
export function setAppJwtFactory(fn: ((appId: string, privateKey: string) => GitHubClient) | undefined): void {
  jwtFactory = fn ?? appJwtClient
}

const INSTALLATIONS_MAX = 500

/** The App's installations (GET /app/installations with the App JWT), for the Installation ID picker. */
export async function listInstallations(): Promise<InstallationOption[]> {
  const creds = await appCredentials()
  if (!creds) throw new UnavailableError('set the App ID and the App private key first')
  const gh = jwtFactory(creds.appId, creds.privateKey)
  let list: { id: number; account?: { login?: string; type?: string } | null }[]
  try {
    list = await gh.paginate('GET /app/installations', {}, INSTALLATIONS_MAX)
  } catch (err) {
    // The UI shows this reason next to the picker; a bad key or App ID is the usual cause.
    if (err instanceof GitHubError || err instanceof Error) throw new AppError(`GitHub answered ${err instanceof GitHubError ? err.status : 'an error'}: ${err.message}`, 502, 'upstream')
    throw err
  }
  return list
    .filter((i) => typeof i.id === 'number')
    .map((i) => ({ id: i.id, account: i.account?.login ?? 'unknown account', type: i.account?.type === 'Organization' ? 'organization' : 'user' }))
    .sort((a, b) => a.account.localeCompare(b.account))
}

export const LOOKUP_REPOS_MAX = 10
const LOOKUP_CONCURRENCY = 3

/**
 * Union of the lookups (branches, checks, teams, environments) of the repos a set is assigned to; the first
 * LOOKUP_REPOS_MAX repos only, LOOKUP_CONCURRENCY at a time. A repo GitHub refuses is counted in `failed`.
 */
export async function setLookups(set: string): Promise<{ lookups: Lookups; repos: string[]; total: number; failed: string[] }> {
  const assigned = (await svc.listRepos()).filter((r) => r.sets.some((s) => s.set === set)).map((r) => r.full_name)
  const repos = assigned.slice(0, LOOKUP_REPOS_MAX)
  const acc = { branches: new Set<string>(), checks: new Set<string>(), teams: new Set<string>(), environments: new Set<string>() }
  const failed: string[] = []
  const queue = repos.slice()
  const worker = async () => {
    for (let repo = queue.shift(); repo; repo = queue.shift()) {
      try {
        const l = await svc.repoLookups(repo)
        for (const k of Object.keys(acc) as (keyof Lookups)[]) for (const v of l[k]) acc[k].add(v)
      } catch {
        failed.push(repo)
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(LOOKUP_CONCURRENCY, repos.length) }, worker))
  const sorted = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b))
  return {
    lookups: { branches: sorted(acc.branches), checks: sorted(acc.checks), teams: sorted(acc.teams), environments: sorted(acc.environments) },
    repos,
    total: assigned.length,
    failed,
  }
}
