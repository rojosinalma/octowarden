import { z } from 'zod'
import { createPlan, type PlanRequest } from '../../services'
import { defineTool } from './define'
import { repo, values } from './shared'

export const planTool = defineTool({
  name: 'plan',
  description:
    'Compute what apply would change on one repo, reading GitHub only. Target: sets and/or templates by name, or doc (an inline Template or Set); ' +
    'none = the repo\'s assigned sets. Returns the plan: id (use with apply within 30 minutes), changes [{section, op, target, before, after, destructive}], ' +
    'skipped sections with reasons, and the destructive count.',
  inputSchema: { repo, sets: z.array(z.string()).optional(), templates: z.array(z.string()).optional(), doc: z.record(z.string(), z.unknown()).optional(), values: values.optional() },
  destructive: false,
  readOnly: true,
  handler: async (args, ctx) => ({ plan: await createPlan(args as PlanRequest, ctx) }),
})
