import { z } from 'zod'
import { githubClient } from '../auth/providers'
import { db } from '../db'
import type { DriftState } from '../db/schema'
import { GitHubError, type GitHubClient } from '../github/client'
import { getRepo as fetchRepo, parseFullName, repoResponseSchema, toRepoInfo, type RepoInfo } from '../github/repo'
import { listEvents, recordEvent, type Event } from '../lib/events'
import { AppError, NotFoundError, UnavailableError, ValidationError } from '../lib/json'
import { log } from '../lib/log'
import { getCachedRepo, listCachedRepos, upsertRepo, type CachedRepo } from '../lib/repos'
import { getSetting, getSettingInt } from '../lib/settings'
import { nameSchema, valuesSchema } from '../templates/schema'
import { listAllAssignments, listAssignments } from '../templates/store'
import type { Values } from '../templates/values'
import { requireConfirm, type Ctx } from './context'
import { serverLibrary } from './library'

export type RepoSetAssignment = { set: string; values: Values }

/** One repo as every interface shows it: cached GitHub metadata, assigned sets and the last audit. */
export type RepoRow = {
  full_name: string
  owner: string
  name: string
  private: boolean
  visibility: RepoInfo['visibility'] | 'unknown'
  fork: boolean
  archived: boolean
  default_branch: string
  description: string
  sets: RepoSetAssignment[]
  drift_state: DriftState
  drift_summary: Record<string, unknown>
  last_audit_at: string | null
}

export type RepoDetail = RepoRow & { events: Event[] }
export type RepoLookups = { branches: string[]; checks: string[]; teams: string[]; environments: string[] }

const logger = log.child('github')
const LOOKUP_MAX = 300

type Meta = Partial<RepoInfo> & { description?: string | null }

function toRow(fullName: string, cached: CachedRepo | undefined, sets: RepoSetAssignment[]): RepoRow {
  const m = (cached?.metadata ?? {}) as Meta
  const [owner = '', name = ''] = fullName.split('/')
  return {
    full_name: fullName,
    owner: m.owner ?? owner,
    name: m.name ?? name,
    private: m.private ?? false,
    visibility: m.visibility ?? 'unknown',
    fork: m.fork ?? false,
    archived: m.archived ?? false,
    default_branch: m.default_branch ?? '',
    description: m.description ?? '',
    sets,
    drift_state: cached?.drift_state ?? 'unknown',
    drift_summary: cached?.drift_summary ?? {},
    last_audit_at: cached?.last_audit_at ?? null,
  }
}

const listedRepoSchema = repoResponseSchema.extend({ description: z.string().nullable().optional() })

/** Caches one GitHub repo answer (schema-checked; description kept for the list). */
async function cacheRepo(data: unknown): Promise<RepoInfo> {
  const raw = listedRepoSchema.parse(data)
  const info = toRepoInfo(raw)
  const meta: RepoInfo & { description: string } = { ...info, description: raw.description ?? '' }
  await upsertRepo(meta)
  return info
}

/** Repos visible to the credential: an App lists its installation, a token the user's repos (or one owner's). */
async function fetchRepos(gh: GitHubClient, owner: string | undefined, max: number): Promise<unknown[]> {
  if (owner) {
    try {
      return await gh.paginate('GET /orgs/{org}/repos', { org: owner, type: 'all' }, max)
    } catch (err) {
      if (!(err instanceof GitHubError) || err.status !== 404) throw err
      if (gh.mode === 'app') return (await gh.paginate('GET /installation/repositories', {}, max)).filter((r) => ownerOf(r) === owner.toLowerCase())
      return await gh.paginate('GET /user/repos', { affiliation: 'owner,collaborator,organization_member' }, max).then((list) =>
        list.filter((r) => ownerOf(r) === owner.toLowerCase()),
      )
    }
  }
  if (gh.mode === 'app') return gh.paginate('GET /installation/repositories', {}, max)
  return gh.paginate('GET /user/repos', { affiliation: 'owner,collaborator,organization_member' }, max)
}

function ownerOf(r: unknown): string {
  return String((r as { owner?: { login?: string } }).owner?.login ?? '').toLowerCase()
}

/** Re-reads the repo list from GitHub into the cache. A full refresh drops cached repos GitHub no longer lists (unless assigned). */
export async function refreshRepos(owner?: string): Promise<number> {
  const gh = await githubClient()
  const max = await getSettingInt('repos_refresh_max')
  const list = await fetchRepos(gh, owner, max)
  const seen = new Set<string>()
  for (const r of list) {
    const parsed = listedRepoSchema.safeParse(r)
    if (!parsed.success) continue
    seen.add((await cacheRepo(parsed.data)).full_name)
  }
  if (!owner && list.length < max) {
    const assigned = new Set((await listAllAssignments()).map((a) => a.repo))
    const stale = (await listCachedRepos({ limit: 10_000 })).map((r) => r.full_name).filter((n) => !seen.has(n) && !assigned.has(n))
    for (let i = 0; i < stale.length; i += 200) await db().deleteFrom('repos').where('full_name', 'in', stale.slice(i, i + 200)).execute()
  }
  logger.info(`repo list refreshed: ${seen.size} repos${owner ? ` of ${owner}` : ''}`)
  return seen.size
}

async function assignmentsByRepo(): Promise<Map<string, RepoSetAssignment[]>> {
  const out = new Map<string, RepoSetAssignment[]>()
  for (const a of await listAllAssignments()) {
    const list = out.get(a.repo) ?? []
    list.push({ set: a.set_name, values: a.values })
    out.set(a.repo, list)
  }
  return out
}

/**
 * Cached repos plus every repo with assigned sets, by name. `refresh` (or an empty cache with GitHub
 * credentials) reads the list from GitHub first; `owner` filters by owner (case-insensitive).
 */
export async function listRepos(opts: { refresh?: boolean; owner?: string } = {}): Promise<RepoRow[]> {
  let cached = await listCachedRepos({ limit: 10_000 })
  if (opts.refresh || cached.length === 0) {
    try {
      await refreshRepos(opts.owner)
      cached = await listCachedRepos({ limit: 10_000 })
    } catch (err) {
      if (opts.refresh) throw err
      if (!(err instanceof UnavailableError)) logger.warn(`repo list refresh failed: ${(err as Error).message}`)
    }
  }
  const assigned = await assignmentsByRepo()
  const byName = new Map(cached.map((c) => [c.full_name, c]))
  const names = new Set([...byName.keys(), ...assigned.keys()])
  const owner = opts.owner?.toLowerCase()
  return [...names]
    .filter((n) => !owner || n.split('/')[0]!.toLowerCase() === owner)
    .sort((a, b) => a.localeCompare(b))
    .map((n) => toRow(n, byName.get(n), assigned.get(n) ?? []))
}

function checkName(fullName: string): void {
  try {
    parseFullName(fullName)
  } catch (err) {
    throw new ValidationError((err as Error).message)
  }
}

async function row(fullName: string): Promise<RepoRow> {
  const sets = (await listAssignments(fullName)).map((a) => ({ set: a.set_name, values: a.values }))
  return toRow(fullName, await getCachedRepo(fullName), sets)
}

/** One repo with its last 20 events. Unknown to the cache → read from GitHub (404 when GitHub has none either). */
export async function getRepo(fullName: string): Promise<RepoDetail> {
  checkName(fullName)
  const cached = await getCachedRepo(fullName)
  const sets = await listAssignments(fullName)
  if (!cached || !cached.metadata.full_name) {
    try {
      const { raw } = await fetchRepo(await githubClient(), fullName)
      await cacheRepo(raw)
    } catch (err) {
      if (err instanceof GitHubError && err.status === 404) {
        if (!sets.length) throw new NotFoundError(`repo ${fullName} not found`)
      } else if (!cached && !sets.length) throw err
    }
  }
  return { ...(await row(fullName)), events: await listEvents({ repo: fullName, limit: 20 }) }
}

const assignmentSchema = z.array(z.strictObject({ set: nameSchema, values: valuesSchema.optional() })).max(50)

/** Replaces the repo's assigned sets (order = apply order). Every set must exist. */
export async function assignSets(fullName: string, sets: { set: string; values?: Values }[], ctx: Ctx): Promise<RepoRow> {
  checkName(fullName)
  const list = assignmentSchema.parse(sets)
  const dupes = list.map((s) => s.set).filter((s, i, all) => all.indexOf(s) !== i)
  if (dupes.length) throw new ValidationError(`set listed twice: ${[...new Set(dupes)].join(', ')}`)
  const missing: string[] = []
  for (const s of list) if (!(await serverLibrary.getSet(s.set))) missing.push(s.set)
  if (missing.length) throw new NotFoundError(`unknown sets: ${missing.join(', ')}`)
  const before = (await listAssignments(fullName)).map((a) => a.set_name)
  await db()
    .transaction()
    .execute(async (trx) => {
      await trx.deleteFrom('repo_sets').where('repo', '=', fullName).execute()
      const now = new Date().toISOString()
      if (list.length) {
        await trx
          .insertInto('repo_sets')
          .values(list.map((s, position) => ({ repo: fullName, set_name: s.set, values: JSON.stringify(s.values ?? {}), position, created_at: now })))
          .execute()
      }
    })
  await recordEvent({
    actor: ctx.actor,
    source: ctx.source,
    repo: fullName,
    action: 'repo.assign_sets',
    outcome: 'info',
    diff: { before, after: list.map((s) => s.set) },
    message: list.length ? `sets: ${list.map((s) => s.set).join(', ')}` : 'no sets assigned',
  })
  return row(fullName)
}

export type CreateRepoInput = { owner?: string; name: string; private: boolean; description?: string; sets?: { set: string; values?: Values }[] }

const createSchema = z.strictObject({
  owner: z.string().regex(/^[A-Za-z0-9-]{1,39}$/).optional(),
  name: z.string().regex(/^[A-Za-z0-9._-]{1,100}$/, 'letters, digits, . _ -'),
  private: z.boolean(),
  description: z.string().max(350).optional(),
  sets: assignmentSchema.optional(),
})

/**
 * Creates a repo on GitHub: under an organization (`POST /orgs/{org}/repos`) or the token's user
 * (`POST /user/repos`). `owner` defaults to the `default_owner` setting. Assigns `sets` when given; nothing is applied.
 */
export async function createRepo(input: CreateRepoInput, ctx: Ctx): Promise<RepoRow> {
  const v = createSchema.parse(input)
  const owner = v.owner || (await getSetting('default_owner')) || undefined
  const gh = await githubClient()
  for (const s of v.sets ?? []) if (!(await serverLibrary.getSet(s.set))) throw new NotFoundError(`unknown set ${s.set}`)
  const body = { name: v.name, private: v.private, ...(v.description ? { description: v.description } : {}) }
  let data: unknown
  let isOrg = false
  if (owner) {
    const { data: who } = await gh.request<{ type?: string; login: string }>('GET /users/{username}', { username: owner })
    isOrg = who.type === 'Organization'
  }
  if (isOrg) data = (await gh.request('POST /orgs/{org}/repos', { org: owner, ...body })).data
  else {
    if (gh.mode === 'app') throw new ValidationError('a GitHub App can only create repos in an organization: set owner to an organization')
    data = (await gh.request('POST /user/repos', body)).data
  }
  const info = await cacheRepo(data)
  if (owner && info.owner.toLowerCase() !== owner.toLowerCase()) {
    logger.warn(`repo created as ${info.full_name}, not under ${owner}: the token's user is not ${owner}`)
  }
  await recordEvent({
    actor: ctx.actor,
    source: ctx.source,
    repo: info.full_name,
    action: 'repo.create',
    outcome: 'applied',
    diff: { after: { ...body, owner: info.owner } },
    message: `repo ${info.full_name} created (${v.private ? 'private' : 'public'})`,
  })
  if (v.sets?.length) return assignSets(info.full_name, v.sets, ctx)
  return row(info.full_name)
}

/** Deletes a repo on GitHub — irreversible. `confirm` must equal the full name; the deletion is recorded. */
export async function deleteRepo(fullName: string, confirm: string | undefined, ctx: Ctx): Promise<RepoRow> {
  checkName(fullName)
  requireConfirm(fullName, confirm, `delete repo ${fullName}`)
  const gh = await githubClient()
  const snapshot = await row(fullName)
  const { owner, name } = parseFullName(fullName)
  try {
    await gh.request('DELETE /repos/{owner}/{repo}', { owner, repo: name })
  } catch (err) {
    await recordEvent({ actor: ctx.actor, source: ctx.source, repo: fullName, action: 'repo.delete', outcome: 'failed', message: (err as Error).message })
    if (err instanceof GitHubError && err.status === 404) throw new NotFoundError(`repo ${fullName} not found`)
    if (err instanceof GitHubError && err.status === 403) throw new AppError(`GitHub refused: ${err.message} (the credential needs delete_repo / administration)`, 403, 'forbidden')
    throw err
  }
  await db().deleteFrom('repo_sets').where('repo', '=', fullName).execute()
  await db().deleteFrom('repos').where('full_name', '=', fullName).execute()
  await recordEvent({ actor: ctx.actor, source: ctx.source, repo: fullName, action: 'repo.delete', outcome: 'applied', message: `repo ${fullName} deleted` })
  return snapshot
}

async function settled<T>(what: string, repo: string, fn: () => Promise<T[]>): Promise<T[]> {
  try {
    return await fn()
  } catch (err) {
    logger.warn(`${repo}: ${what} lookup failed: ${(err as Error).message}`)
    return []
  }
}

const uniqueSorted = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort((a, b) => a.localeCompare(b))

/**
 * Values for UI pickers: branch names, status check names seen on the default branch's latest commit
 * (check runs and commit statuses), team slugs (organizations only) and environment names.
 * A lookup GitHub refuses comes back empty instead of failing the rest.
 */
export async function repoLookups(fullName: string): Promise<RepoLookups> {
  checkName(fullName)
  const gh = await githubClient()
  const { info, raw } = await fetchRepo(gh, fullName)
  const p = { owner: info.owner, repo: info.name }
  const isOrg = (raw.owner as { type?: string }).type === 'Organization'
  const [branches, checks, teams, environments] = await Promise.all([
    settled('branches', fullName, async () => (await gh.paginate<{ name: string }>('GET /repos/{owner}/{repo}/branches', p, LOOKUP_MAX)).map((b) => b.name)),
    settled('checks', fullName, async () => {
      const ref = info.default_branch
      const [runs, status] = await Promise.all([
        gh.request<{ check_runs?: { name: string }[] }>('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', { ...p, ref, per_page: 100 }).catch(() => undefined),
        gh.request<{ statuses?: { context: string }[] }>('GET /repos/{owner}/{repo}/commits/{ref}/status', { ...p, ref, per_page: 100 }).catch(() => undefined),
      ])
      return [...(runs?.data.check_runs ?? []).map((r) => r.name), ...(status?.data.statuses ?? []).map((s) => s.context)]
    }),
    isOrg ? settled('teams', fullName, async () => (await gh.paginate<{ slug: string }>('GET /orgs/{org}/teams', { org: info.owner }, LOOKUP_MAX)).map((t) => t.slug)) : Promise.resolve([]),
    settled('environments', fullName, async () => {
      const { data } = await gh.request<{ environments?: { name: string }[] }>('GET /repos/{owner}/{repo}/environments', { ...p, per_page: 100 })
      return (data.environments ?? []).map((e) => e.name)
    }),
  ])
  return { branches: uniqueSorted(branches), checks: uniqueSorted(checks), teams: uniqueSorted(teams), environments: uniqueSorted(environments) }
}
