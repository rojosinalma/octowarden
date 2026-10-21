import { z } from 'zod'
import { listEvents as storeEvents, type Event } from '../lib/events'
import { NotFoundError } from '../lib/json'
import { getRun as storeRun, listRuns as storeRuns, type Run } from '../lib/runs'

export type { Event } from '../lib/events'
export type { Run } from '../lib/runs'

export const SOURCES = ['ui', 'cli', 'api', 'mcp', 'scheduler'] as const
export const OUTCOMES = ['applied', 'skipped', 'failed', 'planned', 'drift', 'clean', 'info'] as const
export const RUN_KINDS = ['plan', 'apply', 'sync', 'audit'] as const

export type EventQuery = { repo?: string; section?: string; source?: string; actor?: string; outcome?: string; since?: string; run_id?: string; before?: string; limit?: number }

export const eventQuerySchema = z.strictObject({
  repo: z.string().max(200).optional(),
  section: z.string().max(64).optional(),
  source: z.enum(SOURCES).optional(),
  actor: z.string().max(100).optional(),
  outcome: z.enum(OUTCOMES).optional(),
  since: z.iso.datetime({ offset: true }).or(z.iso.date()).optional(),
  run_id: z.string().max(64).optional(),
  before: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
})

export async function listRuns(opts: { limit?: number; kind?: (typeof RUN_KINDS)[number] } = {}): Promise<Run[]> {
  return storeRuns(opts)
}

export async function getRun(id: string): Promise<Run> {
  const r = await storeRun(id)
  if (!r) throw new NotFoundError(`run ${id} not found`)
  return r
}

/** Audit events, newest first (max 500); empty filter values are ignored. */
export async function listEvents(filter: EventQuery = {}): Promise<Event[]> {
  const clean = Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined && v !== ''))
  const f = eventQuerySchema.parse(clean)
  const since = f.since && /^\d{4}-\d{2}-\d{2}$/.test(f.since) ? `${f.since}T00:00:00.000Z` : f.since ? new Date(f.since).toISOString() : undefined
  return storeEvents({ ...f, since })
}
