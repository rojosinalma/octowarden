import { db } from '../db'
import type { EventOutcome, EventRow, Source } from '../db/schema'
import { newId, nowIso, parseJson, toJson } from '../db/util'
import { bus } from './bus'
import { log, redact } from './log'
import { getSettingInt, SECRET_KEYS } from './settings'

export type EventInput = {
  actor: string
  source: Source
  action: string
  outcome: EventOutcome
  repo?: string | null
  section?: string | null
  /** Any shape; redacted before it is stored. */
  diff?: unknown
  message?: string
  run_id?: string | null
}

export type Event = Omit<EventRow, 'diff'> & { diff: unknown }

export type EventFilter = {
  repo?: string
  section?: string
  outcome?: EventOutcome
  source?: Source
  actor?: string
  run_id?: string
  /** ISO timestamp, inclusive. */
  since?: string
  /** Event id: return older events only (pagination). */
  before?: string
  /** Default 100, max 500. */
  limit?: number
}

export const EVENTS_MAX_LIMIT = 500
const logger = log.child('audit')

/** Stores one audit event (diff redacted) and publishes it on the bus. */
const URL_RE = /\bhttps?:\/\/[^\s"'<>]+/g

/** Webhook URLs often carry a token in the path or query: the audit trail keeps only origin and first segment. */
export function maskUrls<T>(value: T): T {
  if (typeof value === 'string')
    return value.replace(URL_RE, (u) => {
      try {
        const url = new URL(u)
        const first = url.pathname.split('/').filter(Boolean)[0]
        const rest = url.pathname.split('/').filter(Boolean).length > 1 || url.search ? '/…' : ''
        return `${url.origin}${first ? `/${first}` : ''}${rest}`
      } catch {
        return u
      }
    }) as T
  if (Array.isArray(value)) return value.map(maskUrls) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskUrls(v)])) as T
  return value
}

export async function recordEvent(input: EventInput): Promise<Event> {
  const diff = input.diff === undefined ? null : maskUrls(redact(input.diff, SECRET_KEYS))
  const row: EventRow = {
    id: newId(),
    at: nowIso(),
    actor: input.actor,
    source: input.source,
    repo: input.repo ?? null,
    section: input.section ?? null,
    action: input.action,
    outcome: input.outcome,
    diff: diff === null ? null : toJson(diff),
    message: maskUrls(input.message ?? ''),
    run_id: input.run_id ?? null,
  }
  await db().insertInto('events').values(row).execute()
  bus.publish('event', { id: row.id, repo: row.repo, section: row.section, outcome: row.outcome, action: row.action, run_id: row.run_id })
  return { ...row, diff }
}

/** Newest first. */
export async function listEvents(filter: EventFilter = {}): Promise<Event[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), EVENTS_MAX_LIMIT)
  let q = db().selectFrom('events').selectAll()
  if (filter.repo) q = q.where('repo', '=', filter.repo)
  if (filter.section) q = q.where('section', '=', filter.section)
  if (filter.outcome) q = q.where('outcome', '=', filter.outcome)
  if (filter.source) q = q.where('source', '=', filter.source)
  if (filter.actor) q = q.where('actor', '=', filter.actor)
  if (filter.run_id) q = q.where('run_id', '=', filter.run_id)
  if (filter.since) q = q.where('at', '>=', filter.since)
  if (filter.before) q = q.where('id', '<', filter.before)
  const rows = await q.orderBy('id', 'desc').limit(limit).execute()
  return rows.map((r) => ({ ...r, diff: parseJson(r.diff, null) }))
}

export async function getEvent(id: string): Promise<Event | undefined> {
  const r = await db().selectFrom('events').selectAll().where('id', '=', id).executeTakeFirst()
  return r && { ...r, diff: parseJson(r.diff, null) }
}

/** Deletes events (and finished runs) older than `audit_retention_days`; returns rows removed. */
export async function purgeEvents(now = Date.now()): Promise<{ events: number; runs: number }> {
  const days = await getSettingInt('audit_retention_days')
  const cutoff = new Date(now - days * 86_400_000).toISOString()
  const ev = await db().deleteFrom('events').where('at', '<', cutoff).executeTakeFirst()
  const runs = await db().deleteFrom('runs').where('started_at', '<', cutoff).where('finished_at', 'is not', null).executeTakeFirst()
  const out = { events: Number(ev.numDeletedRows), runs: Number(runs.numDeletedRows) }
  if (out.events || out.runs) logger.info(`purged ${out.events} events and ${out.runs} runs older than ${days} days`)
  return out
}
