import type { AnyElysia } from 'elysia'
import { z } from 'zod'
import { jsonOk } from '../../lib/json'
import { applyPlan, createPlan, planAndApply, startAudit, startBulk, type BulkRequest, type PlanRequest } from '../../services'
import { bodyOf, ctx } from './shared'

const applyById = z.strictObject({ plan_id: z.string().min(1).max(64), confirm: z.string().max(300).optional() })
const auditBody = z.strictObject({ repos: z.array(z.string()).max(10_000).optional() })

export function routes(app: AnyElysia) {
  app
    .post('/plan', async ({ body }) => {
      const plan = await createPlan(bodyOf(body) as PlanRequest, ctx)
      return jsonOk(`${plan.changes.length} changes, ${plan.skipped.length} skipped`, { plan })
    })
    .post('/apply', async ({ body }) => {
      const b = bodyOf(body)
      if ('plan_id' in b) {
        const { plan_id, confirm } = applyById.parse(b)
        const report = await applyPlan(plan_id, { confirm }, ctx)
        return jsonOk(`${report.applied} applied, ${report.failed} failed`, { report })
      }
      const { plan, report } = await planAndApply(b as PlanRequest & { confirm?: string }, ctx)
      return jsonOk(`${report.applied} applied, ${report.failed} failed`, { plan, report })
    })
    .post('/bulk', async ({ body, set }) => {
      const { run_id } = await startBulk(bodyOf(body) as BulkRequest, ctx)
      set.status = 202
      return jsonOk('bulk run started', { run_id })
    })
    .post('/audit', async ({ body, set }) => {
      const { repos } = auditBody.parse(bodyOf(body))
      const { run_id } = await startAudit({ repos }, ctx)
      set.status = 202
      return jsonOk('audit started', { run_id })
    })
}
