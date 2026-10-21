import { db } from '../db'
import type { RunKind, RunRow, RunStatus, Source } from '../db/schema'
import { newId, nowIso, parseJson, toJson } from '../db/util'
import { bus } from './bus'
import { redact } from './log'
import { SECRET_KEYS } from './settings'

export type Run = Omit<RunRow, 'summary'> & { summary: Record<string, unknown> }

export async function startRun(kind: RunKind, source: Source, actor: string): Promise<Run> {
  const row: RunRow = { id: newId(), kind, source, actor, status: 'running', started_at: nowIso(), finished_at: null, summary: '{}' }
  await db().insertInto('runs').values(row).execute()
  bus.publish('run', { id: row.id, kind, status: row.status })
  return { ...row, summary: {} }
}

/** Marks a run finished with a status and a (redacted) summary. */
export async function finishRun(id: string, status: RunStatus, summary: Record<string, unknown> = {}): Promise<void> {
  const safe = redact(summary, SECRET_KEYS)
  const r = await db()
    .updateTable('runs')
    .set({ status, finished_at: nowIso(), summary: toJson(safe) })
    .where('id', '=', id)
    .returning('kind')
    .executeTakeFirst()
  bus.publish('run', { id, kind: r?.kind ?? '', status })
}

export async function getRun(id: string): Promise<Run | undefined> {
  const r = await db().selectFrom('runs').selectAll().where('id', '=', id).executeTakeFirst()
  return r && { ...r, summary: parseJson(r.summary, {}) }
}

/** Newest first; limit max 200. */
export async function listRuns(opts: { kind?: RunKind; limit?: number } = {}): Promise<Run[]> {
  let q = db().selectFrom('runs').selectAll()
  if (opts.kind) q = q.where('kind', '=', opts.kind)
  const rows = await q.orderBy('id', 'desc').limit(Math.min(Math.max(opts.limit ?? 50, 1), 200)).execute()
  return rows.map((r) => ({ ...r, summary: parseJson(r.summary, {}) }))
}
