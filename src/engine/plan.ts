import { githubClient } from '../auth/providers'
import { dbConnected } from '../db'
import { nowIso } from '../db/util'
import { isPlanLimit, type GitHubClient } from '../github/client'
import { getRepo } from '../github/repo'
import { gapsFor, githubStatus, type Gap } from '../github/status'
import { recordEvent } from '../lib/events'
import { ValidationError, zodMessage } from '../lib/json'
import { log } from '../lib/log'
import { upsertRepo } from '../lib/repos'
import { finishRun, startRun } from '../lib/runs'
import { getSection } from '../sections'
import type { RepoInfo } from '../sections/types'
import type { Template } from '../templates/library'
import { mergeSections } from '../templates/merge'
import { MissingValuesError, substitute, type Values } from '../templates/values'
import { resolveTarget } from './resolve'
import type { Plan, PlanInput, SectionSummary, Skipped } from './types'

const logger = log.child('apply')

/** Templates whose `requires.visibility` does not match the repo are dropped with a reason. */
function fitTemplates(repo: RepoInfo, templates: Template[]): { fit: Template[]; skipped: Skipped[] } {
  const fit: Template[] = []
  const skipped: Skipped[] = []
  for (const t of templates) {
    const want = t.requires.visibility
    if (want && want !== 'any' && want !== (repo.private ? 'private' : 'public')) {
      for (const section of Object.keys(t.sections)) skipped.push({ section, template: t.name, reason: `template "${t.name}" requires a ${want} repo` })
      continue
    }
    fit.push(t)
  }
  return { fit, skipped }
}

/**
 * Values every template can use without a set providing them (lowest precedence): `owner`, `repo`,
 * `full_name`, `default_branch` of the target repo.
 */
export function implicitValues(repo: RepoInfo): Values {
  return { owner: repo.owner, repo: repo.name, full_name: repo.full_name, default_branch: repo.default_branch }
}

/** Definite permission gaps for this repo; none when the check is off or GitHub's answer is unknown. */
async function accessGaps(input: PlanInput, owner: string): Promise<Gap[]> {
  if (input.access === false) return []
  const status = input.access ?? (input.gh ? undefined : await githubStatus())
  return status ? gapsFor(status, owner) : []
}

/** Reads and diffs every section; never writes. Not recorded (plan() and audit() record). */
export async function buildPlan(input: PlanInput, gh: GitHubClient): Promise<Plan> {
  const resolved = await resolveTarget(input.repo, input, input.library)
  const { info: repo } = await getRepo(gh, input.repo)
  const { fit, skipped } = fitTemplates(repo, resolved.templates)
  const gaps = await accessGaps(input, repo.owner)

  let desired: Record<string, unknown>
  try {
    const merged = mergeSections(fit.map((t) => t.sections))
    for (const [name, raw] of Object.entries(merged)) {
      const expand = getSection(name)?.expand
      if (expand) merged[name] = expand(raw)
    }
    desired = substitute(merged, { ...implicitValues(repo), ...resolved.values })
  } catch (err) {
    if (err instanceof MissingValuesError) throw new ValidationError(err.message, { missing: err.missing })
    throw err
  }

  const plan: Plan = {
    id: null,
    repo,
    sets: resolved.sets,
    templates: resolved.templates.map((t) => t.name),
    values: resolved.values,
    desired: {},
    changes: [],
    skipped,
    sections: [],
    destructive: 0,
    created_at: nowIso(),
  }

  for (const [name, raw] of Object.entries(desired)) {
    const section = getSection(name)
    if (!section) {
      plan.skipped.push({ section: name, reason: `unknown section "${name}"` })
      continue
    }
    const parsed = section.schema.safeParse(raw)
    if (!parsed.success) throw new ValidationError(`section ${name}: ${zodMessage(parsed.error)}`)
    plan.desired[name] = parsed.data
    const support = section.supports?.(repo) ?? { ok: true }
    const summary: SectionSummary = { section: name, changes: 0, noop: 0 }
    plan.sections.push(summary)
    if (!support.ok) {
      plan.skipped.push({ section: name, reason: support.reason })
      summary.skipped = support.reason
      continue
    }
    const sectionGaps = gaps.filter((g) => g.permission.sections.includes(name))
    const blocking = sectionGaps.find((g) => !g.permission.applies)
    if (blocking) {
      plan.skipped.push({ section: name, reason: blocking.reason })
      summary.skipped = blocking.reason
      continue
    }
    let current: unknown
    try {
      current = await section.read({ gh, repo, dryRun: true, log: logger.child(name) }, parsed.data)
    } catch (err) {
      if (!isPlanLimit(err)) throw err
      plan.skipped.push({ section: name, reason: err.message })
      summary.skipped = err.message
      continue
    }
    for (const change of section.diff(parsed.data, current, repo)) {
      const gap = change.op === 'noop' ? undefined : sectionGaps.find((g) => g.permission.applies?.(change))
      if (change.skip) plan.skipped.push({ section: name, target: change.target, reason: change.skip })
      else if (gap) plan.skipped.push({ section: name, target: change.target, reason: gap.reason })
      else if (change.op === 'noop') summary.noop++
      else {
        summary.changes++
        plan.changes.push(change)
        if (change.destructive) plan.destructive++
      }
    }
  }
  return plan
}

export function recording(record: boolean | undefined): boolean {
  return record !== false && dbConnected()
}

/** Plan for one repo: what apply would change. Records a `plan` run and one event when a DB is connected. */
export async function plan(input: PlanInput): Promise<Plan> {
  const gh = input.gh ?? (await githubClient())
  const rec = recording(input.record)
  const run = rec ? await startRun('plan', input.source, input.actor) : undefined
  try {
    const p = await buildPlan(input, gh)
    p.id = run?.id ?? null
    if (rec) {
      await upsertRepo(p.repo)
      await recordEvent({
        actor: input.actor,
        source: input.source,
        repo: p.repo.full_name,
        action: 'plan',
        outcome: 'planned',
        diff: { changes: p.changes, skipped: p.skipped },
        message: `${p.changes.length} changes, ${p.skipped.length} skipped`,
        run_id: run!.id,
      })
      await finishRun(run!.id, 'ok', { repo: p.repo.full_name, changes: p.changes.length, skipped: p.skipped.length, destructive: p.destructive })
    }
    return p
  } catch (err) {
    if (run) await finishRun(run.id, 'failed', { repo: input.repo, error: (err as Error).message })
    throw err
  }
}
