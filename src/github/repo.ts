import { z } from 'zod'
import type { GitHubClient } from './client'

/** The repo facts every section sees. */
export type RepoInfo = {
  owner: string
  name: string
  full_name: string
  private: boolean
  visibility: 'public' | 'private' | 'internal'
  default_branch: string
  fork: boolean
  archived: boolean
}

/** GET /repos/{owner}/{repo} as far as octowarden relies on it (schema-checked before use or storage). */
export const repoResponseSchema = z.looseObject({
  name: z.string(),
  full_name: z.string(),
  owner: z.looseObject({ login: z.string() }),
  private: z.boolean(),
  visibility: z.enum(['public', 'private', 'internal']).optional(),
  default_branch: z.string(),
  fork: z.boolean(),
  archived: z.boolean(),
})
export type RepoResponse = z.infer<typeof repoResponseSchema>

const FULL_NAME = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

/** `owner/name` → parts; throws on anything else. */
export function parseFullName(fullName: string): { owner: string; name: string } {
  if (!FULL_NAME.test(fullName)) throw new Error(`repo must be "owner/name", got "${fullName}"`)
  const [owner, name] = fullName.split('/') as [string, string]
  return { owner, name }
}

export function toRepoInfo(data: unknown): RepoInfo {
  const r = repoResponseSchema.parse(data)
  return {
    owner: r.owner.login,
    name: r.name,
    full_name: r.full_name,
    private: r.private,
    visibility: r.visibility ?? (r.private ? 'private' : 'public'),
    default_branch: r.default_branch,
    fork: r.fork,
    archived: r.archived,
  }
}

/** Fetches and schema-checks one repo. */
export async function getRepo(gh: GitHubClient, fullName: string): Promise<{ info: RepoInfo; raw: RepoResponse }> {
  const { owner, name } = parseFullName(fullName)
  const { data } = await gh.request('GET /repos/{owner}/{repo}', { owner, repo: name })
  const raw = repoResponseSchema.parse(data)
  return { info: toRepoInfo(raw), raw }
}
