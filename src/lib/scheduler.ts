import { resolveAuth } from '../auth/providers'
import { rateLimits } from '../github/client'
import { assignedRepos, SCHEDULER_CTX, startAudit, waitForBulk } from '../services'
import { purgeEvents } from './events'
import { log } from './log'
import { getSettingInt } from './settings'

const logger = log.child('scheduler')

export type SchedulerStatus = { running: boolean; next_at: string | null; last_tick_at: string | null; last_audit_run: string | null; last_skip: string | null }

const state: SchedulerStatus = { running: false, next_at: null, last_tick_at: null, last_audit_run: null, last_skip: null }
let timer: Timer | undefined
let ticking: Promise<void> | undefined
let stopped = true

export function schedulerStatus(): SchedulerStatus {
  return { ...state }
}

async function delayMs(first: boolean): Promise<number> {
  const jitter = Math.random() * (await getSettingInt('audit_jitter_s')) * 1000
  if (first) return jitter
  return Math.max(1, await getSettingInt('audit_interval_min')) * 60_000 + jitter
}

function skip(reason: string): void {
  state.last_skip = reason
  logger.info(`audit skipped: ${reason}`)
}

/**
 * One pass: purge old events, then audit every repo with assigned sets (as `scheduler`) and wait for it.
 * Skips the audit without GitHub credentials, with `audit_interval_min` 0, or with the core rate limit low.
 * Settings are read on every tick. Never throws.
 */
export async function tick(): Promise<void> {
  state.last_tick_at = new Date().toISOString()
  try {
    await purgeEvents()
  } catch (err) {
    logger.error('event purge failed', err instanceof Error ? err : String(err))
  }
  try {
    if ((await getSettingInt('audit_interval_min')) === 0) return skip('audit_interval_min is 0 (disabled)')
    if (!(await resolveAuth())) return skip('no GitHub credentials')
    const core = rateLimits().find((r) => r.resource === 'core')
    const floor = await getSettingInt('audit_min_rate_remaining')
    if (core && core.remaining < floor && core.reset * 1000 > Date.now()) return skip(`GitHub rate limit low (${core.remaining} < ${floor})`)
    const repos = await assignedRepos()
    if (!repos.length) return skip('no repos with assigned sets')
    const { run_id } = await startAudit({ repos }, SCHEDULER_CTX)
    state.last_audit_run = run_id
    state.last_skip = null
    logger.info(`audit ${run_id} started for ${repos.length} repos`)
    await waitForBulk(run_id)
  } catch (err) {
    logger.error('scheduled audit failed', err instanceof Error ? err : String(err))
  }
}

async function schedule(first: boolean): Promise<void> {
  if (stopped) return
  const ms = await delayMs(first).catch(() => 60_000)
  if (stopped) return
  state.next_at = new Date(Date.now() + ms).toISOString()
  timer = setTimeout(() => {
    ticking = tick().finally(() => {
      ticking = undefined
      void schedule(false)
    })
  }, ms)
}

/** Starts the one in-process loop (idempotent). The first tick runs after the jitter only. */
export function startScheduler(): void {
  if (!stopped) return
  stopped = false
  state.running = true
  logger.info('scheduler started')
  void schedule(true)
}

/** Stops the loop and waits for a tick in progress. */
export async function stopScheduler(): Promise<void> {
  stopped = true
  state.running = false
  state.next_at = null
  clearTimeout(timer)
  await ticking
  logger.info('scheduler stopped')
}
