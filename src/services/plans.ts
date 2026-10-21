import { z } from 'zod'
import { apply, plan as enginePlan } from '../engine'
import type { ApplyReport, Plan } from '../engine/types'
import { newId } from '../db/util'
import { NotFoundError } from '../lib/json'
import { createPlanCache, PLAN_TTL_MS } from '../lib/plans'
import { getSettingInt } from '../lib/settings'
import { documentSchema, nameSchema, repoNameSchema, valuesSchema, type SetDoc, type TemplateDoc } from '../templates/schema'
import type { Values } from '../templates/values'
import type { Ctx } from './context'
import { serverLibrary } from './library'

export type PlanRequest = { repo: string; sets?: string[]; templates?: string[]; doc?: TemplateDoc | SetDoc; values?: Values }

export const planRequestSchema = z.strictObject({
  repo: repoNameSchema,
  sets: z.array(nameSchema).max(50).optional(),
  templates: z.array(nameSchema).max(100).optional(),
  doc: documentSchema.refine((d) => d.kind !== 'Manifest', 'doc must be a Template or a Set').optional(),
  values: valuesSchema.optional(),
})

let ttlMs = PLAN_TTL_MS
const cache = createPlanCache(200, () => ttlMs)

/** Reads and diffs the target on GitHub; nothing is written. The plan waits in memory (LRU, 200, `plan_ttl_min`). */
export async function createPlan(input: PlanRequest, ctx: Ctx): Promise<Plan> {
  const req = planRequestSchema.parse(input)
  ttlMs = (await getSettingInt('plan_ttl_min')) * 60_000 || PLAN_TTL_MS
  const p = await enginePlan({
    repo: req.repo,
    sets: req.sets,
    templates: req.templates,
    doc: req.doc as TemplateDoc | SetDoc | undefined,
    values: req.values,
    source: ctx.source,
    actor: ctx.actor,
    library: serverLibrary,
  })
  p.id ??= newId()
  cache.put(p.id, p)
  return p
}

export async function getPlan(id: string): Promise<Plan> {
  const p = cache.get(id)
  if (!p) throw new NotFoundError(`plan ${id} not found or expired; plan again`)
  return p
}

/**
 * Applies a stored plan. Destructive changes need `confirm` = the repo full name (409 `confirm_required`,
 * the plan stays). An applied plan is dropped.
 */
export async function applyPlan(id: string, opts: { confirm?: string }, ctx: Ctx): Promise<ApplyReport> {
  const p = await getPlan(id)
  const report = await apply(p, { source: ctx.source, actor: ctx.actor, confirm: opts.confirm })
  cache.delete(id)
  return report
}

/** Plan and apply in one call (`POST /api/apply` without `plan_id`). */
export async function planAndApply(input: PlanRequest & { confirm?: string }, ctx: Ctx): Promise<{ plan: Plan; report: ApplyReport }> {
  const { confirm, ...target } = input
  const p = await createPlan(target, ctx)
  return { plan: p, report: await applyPlan(p.id!, { confirm }, ctx) }
}

/** Plans in memory now (tests, metrics). */
export function cachedPlanCount(): number {
  return cache.size()
}

export function clearPlans(): void {
  cache.clear()
}
