import { db } from '../db'
import type { DriftState, RepoRow } from '../db/schema'
import { nowIso, parseJson, toJson } from '../db/util'
import type { RepoInfo } from '../github/repo'
import { bus } from './bus'

export type CachedRepo = Omit<RepoRow, 'metadata' | 'drift_summary'> & { metadata: Partial<RepoInfo>; drift_summary: Record<string, unknown> }

function toCached(r: RepoRow): CachedRepo {
  return { ...r, metadata: parseJson(r.metadata, {}), drift_summary: parseJson(r.drift_summary, {}) }
}

/** Stores the repo's metadata snapshot (no secrets in RepoInfo). */
export async function upsertRepo(info: RepoInfo): Promise<void> {
  const now = nowIso()
  await db()
    .insertInto('repos')
    .values({ full_name: info.full_name, metadata: toJson(info), last_audit_at: null, drift_state: 'unknown', drift_summary: '{}', updated_at: now })
    .onConflict((oc) => oc.column('full_name').doUpdateSet({ metadata: toJson(info), updated_at: now }))
    .execute()
}

export async function setDrift(fullName: string, state: DriftState, summary: Record<string, unknown>): Promise<DriftState | undefined> {
  const now = nowIso()
  const prev = await db().selectFrom('repos').select('drift_state').where('full_name', '=', fullName).executeTakeFirst()
  await db()
    .insertInto('repos')
    .values({ full_name: fullName, metadata: '{}', last_audit_at: now, drift_state: state, drift_summary: toJson(summary), updated_at: now })
    .onConflict((oc) => oc.column('full_name').doUpdateSet({ last_audit_at: now, drift_state: state, drift_summary: toJson(summary), updated_at: now }))
    .execute()
  if (prev?.drift_state !== state) bus.publish('drift', { repo: fullName, state })
  return prev?.drift_state
}

export async function getCachedRepo(fullName: string): Promise<CachedRepo | undefined> {
  const r = await db().selectFrom('repos').selectAll().where('full_name', '=', fullName).executeTakeFirst()
  return r && toCached(r)
}

export async function listCachedRepos(opts: { drift?: DriftState; limit?: number } = {}): Promise<CachedRepo[]> {
  let q = db().selectFrom('repos').selectAll()
  if (opts.drift) q = q.where('drift_state', '=', opts.drift)
  const rows = await q.orderBy('full_name').limit(Math.min(Math.max(opts.limit ?? 1000, 1), 10_000)).execute()
  return rows.map(toCached)
}

/** `{ clean, drift, error, unknown }` counts for /metrics. */
export async function driftCounts(): Promise<Record<DriftState, number>> {
  const rows = await db()
    .selectFrom('repos')
    .select(['drift_state', (eb) => eb.fn.countAll<number | string>().as('n')])
    .groupBy('drift_state')
    .execute()
  const out: Record<DriftState, number> = { clean: 0, drift: 0, error: 0, unknown: 0 }
  for (const r of rows) out[r.drift_state] = Number(r.n)
  return out
}
