import { z } from 'zod'
import { apply, audit, plan as enginePlan } from '../engine'
import type { Plan } from '../engine/types'
import type { RunKind, RunStatus } from '../db/schema'
import { bus } from '../lib/bus'
import { ValidationError } from '../lib/json'
import { log } from '../lib/log'
import { finishRun, startRun } from '../lib/runs'
import { createSemaphore } from '../lib/semaphore'
import { getSettingInt } from '../lib/settings'
import { nameSchema, repoNameSchema, valuesSchema } from '../templates/schema'
import { listAllAssignments } from '../templates/store'
import type { Values } from '../templates/values'
import type { Ctx } from './context'
import { serverLibrary } from './library'

export type BulkMode = 'plan' | 'apply' | 'audit'
export type BulkRequest = { repos: string[]; sets?: string[]; templates?: string[]; values?: Values; mode: BulkMode }
export type BulkRepoResult = { repo: string; status: 'done' | 'failed'; summary: string; changes?: number; applied?: number; failed?: number; skipped?: number; drift?: string; run_id?: string | null }

export const DESTRUCTIVE_SKIP = 'destructive: apply on the single repo with confirm'

export const bulkRequestSchema = z.strictObject({
  repos: z.array(repoNameSchema).min(1),
  sets: z.array(nameSchema).max(50).optional(),
  templates: z.array(nameSchema).max(100).optional(),
  values: valuesSchema.optional(),
  mode: z.enum(['plan', 'apply', 'audit']),
})

const logger = log.child('apply')
const RESULTS_KEPT = 1000
const active = new Map<string, Promise<void>>()

/** Bulk apply never runs destructive changes: they move to `skipped` with DESTRUCTIVE_SKIP. */
function withoutDestructive(p: Plan): Plan {
  if (!p.destructive) return p
  const kept = p.changes.filter((c) => !c.destructive)
  const skipped = p.changes.filter((c) => c.destructive).map((c) => ({ section: c.section, reason: `${DESTRUCTIVE_SKIP} (${c.op} ${c.target})` }))
  return { ...p, changes: kept, skipped: [...p.skipped, ...skipped], destructive: 0 }
}

async function one(mode: BulkMode, repo: string, req: Omit<BulkRequest, 'repos' | 'mode'>, ctx: Ctx): Promise<BulkRepoResult> {
  const target = { sets: req.sets, templates: req.templates, values: req.values, library: serverLibrary, source: ctx.source, actor: ctx.actor }
  if (mode === 'audit') {
    const d = await audit(repo, target)
    return { repo, status: d.state === 'error' ? 'failed' : 'done', summary: d.message, drift: d.state, changes: d.changes.length, run_id: d.run_id }
  }
  const p = await enginePlan({ ...target, repo })
  if (mode === 'plan') {
    return { repo, status: 'done', summary: `${p.changes.length} changes, ${p.skipped.length} skipped`, changes: p.changes.length, skipped: p.skipped.length, run_id: p.id }
  }
  const safe = withoutDestructive(p)
  const r = await apply(safe, { source: ctx.source, actor: ctx.actor })
  const skipped = r.results.filter((x) => x.outcome === 'skipped').length + r.skipped.length
  return {
    repo,
    status: r.failed ? 'failed' : 'done',
    summary: `${r.applied} applied, ${r.failed} failed, ${skipped} skipped`,
    applied: r.applied,
    failed: r.failed,
    skipped,
    run_id: r.run_id,
  }
}

function statusOf(mode: BulkMode, results: BulkRepoResult[]): RunStatus {
  const failed = results.filter((r) => r.status === 'failed').length
  if (failed === results.length && results.length) return 'failed'
  if (failed) return 'partial'
  if (mode === 'audit' && results.some((r) => r.drift === 'drift')) return 'drift'
  return 'ok'
}

const KIND: Record<BulkMode, RunKind> = { plan: 'plan', apply: 'apply', audit: 'audit' }

/**
 * Starts a plan/apply/audit over many repos in the background and returns its run id at once.
 * Concurrency follows `github_concurrency`; progress goes to bus topic `run`
 * (`{run_id, repo, status: running|done|failed, summary}`, then `{run_id, status: finished, totals}`).
 */
export async function startBulk(input: BulkRequest, ctx: Ctx): Promise<{ run_id: string }> {
  const req = bulkRequestSchema.parse(input)
  const repos = [...new Set(req.repos)]
  const max = await getSettingInt('bulk_max_repos')
  if (repos.length > max) throw new ValidationError(`too many repos: ${repos.length} (bulk_max_repos is ${max})`)
  return runMany(req.mode, repos, { sets: req.sets, templates: req.templates, values: req.values }, ctx)
}

async function runMany(mode: BulkMode, repos: string[], target: Omit<BulkRequest, 'repos' | 'mode'>, ctx: Ctx): Promise<{ run_id: string }> {
  const run = await startRun(KIND[mode], ctx.source, ctx.actor)
  const kind = KIND[mode]
  const total = repos.length
  let limit = await getSettingInt('github_concurrency')
  const sem = createSemaphore(() => limit || 1, Math.max(total, 1))
  let done = 0
  const results: BulkRepoResult[] = []

  const job = (async () => {
    await Promise.all(
      repos.map((repo) =>
        sem.run(async () => {
          bus.publish('run', { id: run.id, run_id: run.id, kind, status: 'running', repo, done, total })
          let r: BulkRepoResult
          try {
            r = await one(mode, repo, target, ctx)
          } catch (err) {
            r = { repo, status: 'failed', summary: (err as Error).message }
            logger.warn(`bulk ${mode} ${repo}: ${r.summary}`)
          }
          done++
          if (results.length < RESULTS_KEPT) results.push(r)
          bus.publish('run', { id: run.id, run_id: run.id, kind, status: r.status, repo, done, total, summary: r.summary, message: r.summary })
          limit = await getSettingInt('github_concurrency').catch(() => limit)
        }),
      ),
    )
    const totals = {
      repos: total,
      done: results.filter((r) => r.status === 'done').length,
      failed: results.filter((r) => r.status === 'failed').length,
      ...(mode === 'audit' ? { drift: results.filter((r) => r.drift === 'drift').length, clean: results.filter((r) => r.drift === 'clean').length } : {}),
      ...(mode === 'apply' ? { applied: results.reduce((n, r) => n + (r.applied ?? 0), 0) } : {}),
      ...(mode === 'plan' ? { changes: results.reduce((n, r) => n + (r.changes ?? 0), 0) } : {}),
    }
    await finishRun(run.id, statusOf(mode, results), { bulk: true, mode, totals, results: results.sort((a, b) => a.repo.localeCompare(b.repo)) })
    bus.publish('run', { id: run.id, run_id: run.id, kind, status: 'finished', done, total, totals })
    logger.info(`bulk ${mode} ${run.id}: ${JSON.stringify(totals)}`)
  })().catch(async (err) => {
    logger.error(`bulk ${mode} ${run.id} failed`, err instanceof Error ? err : String(err))
    await finishRun(run.id, 'failed', { bulk: true, mode, error: (err as Error).message }).catch(() => {})
  })
  active.set(run.id, job)
  void job.finally(() => active.delete(run.id))
  return { run_id: run.id }
}

/** Repos with at least one assigned set. */
export async function assignedRepos(): Promise<string[]> {
  return [...new Set((await listAllAssignments()).map((a) => a.repo))].sort()
}

/** Audits `repos` (default: every repo with assigned sets) against their assigned sets, in the background. */
export async function startAudit(input: { repos?: string[] }, ctx: Ctx): Promise<{ run_id: string }> {
  const repos = input.repos?.length ? z.array(repoNameSchema).parse([...new Set(input.repos)]) : await assignedRepos()
  return runMany('audit', repos, {}, ctx)
}

/** True while `id` is a bulk run in flight here (metrics count its per-repo runs, not the wrapper). */
export function isBulkRun(id: string): boolean {
  return active.has(id)
}

/** Bulk runs in flight. */
export function activeBulkRuns(): number {
  return active.size
}

/** Resolves when the bulk run finished (at once when it is not running here). */
export async function waitForBulk(runId: string): Promise<void> {
  await active.get(runId)
}

/** Waits for running bulk jobs, at most `timeoutMs` (shutdown). */
export async function drainBulk(timeoutMs = 10_000): Promise<void> {
  if (!active.size) return
  let timer: Timer | undefined
  await Promise.race([Promise.allSettled([...active.values()]), new Promise((r) => (timer = setTimeout(r, timeoutMs)))])
  clearTimeout(timer)
}
