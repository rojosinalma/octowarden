import { githubClient } from '../auth/providers'
import type { DriftState } from '../db/schema'
import { nowIso } from '../db/util'
import { recordEvent } from '../lib/events'
import { log } from '../lib/log'
import { setDrift, upsertRepo } from '../lib/repos'
import { finishRun, startRun } from '../lib/runs'
import { notify } from '../notifiers'
import { buildPlan, recording } from './plan'
import type { Drift, EngineOptions, Origin, Target } from './types'

const logger = log.child('audit')

/**
 * Compares a repo with its target (default: its assigned sets). Never throws for GitHub failures:
 * they come back as state `error` with the reason. Stores the drift state and notifies when a repo
 * newly drifts.
 */
export async function audit(repo: string, opts: Origin & EngineOptions & Target = { source: 'scheduler', actor: 'scheduler' }): Promise<Drift> {
  const rec = recording(opts.record)
  const run = rec ? await startRun('audit', opts.source, opts.actor) : undefined
  let drift: Drift
  try {
    const gh = opts.gh ?? (await githubClient())
    const p = await buildPlan({ ...opts, repo }, gh)
    const state: DriftState = p.changes.length ? 'drift' : 'clean'
    drift = {
      run_id: run?.id ?? null,
      repo: p.repo.full_name,
      state,
      changes: p.changes,
      skipped: p.skipped,
      checked_at: nowIso(),
      message: state === 'drift' ? `${p.changes.length} changes pending` : 'in sync',
    }
    if (rec) await upsertRepo(p.repo)
  } catch (err) {
    const message = (err as Error).message
    logger.warn(`${repo}: audit failed: ${message}`)
    drift = { run_id: run?.id ?? null, repo, state: 'error', changes: [], skipped: [], checked_at: nowIso(), message }
  }

  if (run) {
    const previous = await setDrift(drift.repo, drift.state, { changes: drift.changes.length, skipped: drift.skipped.length, message: drift.message })
    await recordEvent({
      actor: opts.actor,
      source: opts.source,
      repo: drift.repo,
      action: 'audit',
      outcome: drift.state === 'drift' ? 'drift' : drift.state === 'clean' ? 'clean' : 'failed',
      diff: drift.state === 'drift' ? { changes: drift.changes } : undefined,
      message: drift.message,
      run_id: run.id,
    })
    await finishRun(run.id, drift.state === 'error' ? 'failed' : drift.state === 'drift' ? 'drift' : 'ok', {
      repo: drift.repo,
      state: drift.state,
      changes: drift.changes.length,
    })
    if (drift.state === 'drift' && previous !== 'drift') {
      await notify({
        kind: 'drift',
        title: `Drift on ${drift.repo}`,
        text: drift.changes
          .slice(0, 10)
          .map((c) => `${c.section} ${c.target}: ${JSON.stringify(c.before)} → ${JSON.stringify(c.after)}`)
          .join('\n'),
        repo: drift.repo,
      })
    }
  }
  return drift
}
