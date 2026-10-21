import { z } from 'zod'
import { applyPlan, planAndApply, type PlanRequest } from '../../services'
import { defineTool } from './define'
import { repo, values } from './shared'

export const applyTool = defineTool({
  name: 'apply',
  description:
    'Write changes to GitHub. Give plan_id from plan (preferred: apply exactly what was reviewed), or repo with sets/templates/doc/values to plan and apply in one step. ' +
    'Destructive: when the plan holds destructive changes (deletes, overwrites) it fails with confirm_required unless confirm equals the repo full name. ' +
    'Returns the report: applied, failed, per-change results and skipped sections.',
  inputSchema: {
    plan_id: z.string().optional(),
    repo: repo.optional(),
    sets: z.array(z.string()).optional(),
    templates: z.array(z.string()).optional(),
    doc: z.record(z.string(), z.unknown()).optional(),
    values: values.optional(),
    confirm: z.string().optional().describe('Repo full name, required when the plan has destructive changes'),
  },
  destructive: true,
  readOnly: false,
  handler: async (args, ctx) => {
    const { plan_id, confirm, ...target } = args
    if (plan_id) return { report: await applyPlan(plan_id, { confirm }, ctx) }
    return planAndApply({ ...(target as PlanRequest), confirm }, ctx)
  },
})
