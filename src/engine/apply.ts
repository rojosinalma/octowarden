import { githubClient } from '../auth/providers'
import { isPlanLimit } from '../github/client'
import { recordEvent } from '../lib/events'
import { AppError } from '../lib/json'
import { log } from '../lib/log'
import { finishRun, startRun } from '../lib/runs'
import type { RunStatus } from '../db/schema'
import { notify } from '../notifiers'
import { getSection } from '../sections'
import type { ApplyResult, Change } from '../sections/types'
import { buildPlan, recording } from './plan'
import type { ApplyOptions, ApplyReport, Plan, PlanInput } from './types'

const logger = log.child('apply')

/** Throws 409 `confirm_required` when the plan holds destructive changes and `confirm` is not the repo full name. */
export function checkConfirm(plan: Plan, confirm: string | undefined): void {
  if (plan.destructive === 0 || confirm === plan.repo.full_name) return
  throw new AppError(`plan has ${plan.destructive} destructive changes; confirm with the repo name "${plan.repo.full_name}"`, 409, 'confirm_required', {
    destructive: plan.changes.filter((c) => c.destructive).map((c) => ({ section: c.section, op: c.op, target: c.target })),
  })
}

function statusOf(applied: number, failed: number): RunStatus {
  if (!failed) return 'ok'
  return applied ? 'partial' : 'failed'
}

/** Applies a plan's pending changes section by section. A section failure never stops the others. */
export async function apply(plan: Plan, opts: ApplyOptions): Promise<ApplyReport> {
  checkConfirm(plan, opts.confirm)
  const gh = opts.gh ?? (await githubClient())
  const rec = recording(opts.record)
  const run = rec ? await startRun(opts.kind ?? 'apply', opts.source, opts.actor) : undefined
  const repo = plan.repo
  const results: ApplyResult[] = []

  // Sections with `applyWith` hand their changes to that section (githooks → files: one commit).
  const bySection = new Map<string, Change[]>()
  for (const c of plan.changes) {
    if (c.op === 'noop' || c.skip) continue
    const owner = getSection(c.section)?.applyWith ?? c.section
    bySection.set(owner, [...(bySection.get(owner) ?? []), c])
  }

  for (const [name, changes] of bySection) {
    const section = getSection(name)
    if (!section) {
      for (const change of changes) results.push({ change, outcome: 'skipped', message: `unknown section "${name}"` })
      continue
    }
    try {
      results.push(...(await section.apply({ gh, repo, dryRun: false, log: logger.child(name) }, changes)))
    } catch (err) {
      const message = (err as Error).message
      const outcome = isPlanLimit(err) ? 'skipped' : 'failed'
      if (outcome === 'failed') logger.error(`${repo.full_name} ${name} apply failed`, err instanceof Error ? err : String(err))
      for (const change of changes) results.push({ change, outcome, message })
    }
  }

  const applied = results.filter((r) => r.outcome === 'applied').length
  const failed = results.filter((r) => r.outcome === 'failed').length
  const status = statusOf(applied, failed)
  logger.info(`${repo.full_name}: ${applied} applied, ${failed} failed, ${results.length - applied - failed + plan.skipped.length} skipped`)

  if (run) {
    for (const r of results) {
      await recordEvent({
        actor: opts.actor,
        source: opts.source,
        repo: repo.full_name,
        section: r.change.section,
        action: `${r.change.op} ${r.change.target}`,
        outcome: r.outcome,
        diff: { before: r.change.before, after: r.change.after },
        message: r.message,
        run_id: run.id,
      })
    }
    for (const s of plan.skipped) {
      await recordEvent({ actor: opts.actor, source: opts.source, repo: repo.full_name, section: s.section, action: 'skip', outcome: 'skipped', message: s.reason, run_id: run.id })
    }
    await finishRun(run.id, status, { repo: repo.full_name, applied, failed, skipped: plan.skipped.length })
  }

  if (failed) {
    await notify({
      kind: 'apply_failed',
      title: `Apply failed on ${repo.full_name}`,
      text: results
        .filter((r) => r.outcome === 'failed')
        .slice(0, 10)
        .map((r) => `${r.change.section} ${r.change.target}: ${r.message}`)
        .join('\n'),
      repo: repo.full_name,
    })
  }

  return { run_id: run?.id ?? null, repo: repo.full_name, status, results, skipped: plan.skipped, applied, failed }
}

/** Plan and apply in one step (CLI/API `sync`); the plan itself is not recorded as a separate run. */
export async function sync(input: PlanInput & { confirm?: string }): Promise<{ plan: Plan; report: ApplyReport }> {
  const gh = input.gh ?? (await githubClient())
  const p = await buildPlan(input, gh)
  const report = await apply(p, { source: input.source, actor: input.actor, confirm: input.confirm, gh, record: input.record, kind: 'sync' })
  return { plan: { ...p, id: report.run_id }, report }
}
