import { z } from 'zod'
import { assignSets } from '../../services'
import { defineTool } from './define'
import { repo, values } from './shared'

export const assignSetsTool = defineTool({
  name: 'assign_sets',
  description:
    'Replace the sets assigned to a repo (order = apply order) with optional per-repo values. The scheduler audits assigned repos; ' +
    'plan/apply without sets use these. An empty list unassigns everything. Changes nothing on GitHub.',
  inputSchema: { repo, sets: z.array(z.object({ set: z.string(), values: values.optional() })) },
  destructive: false,
  readOnly: false,
  handler: async (args, ctx) => ({ repo: await assignSets(args.repo, args.sets, ctx) }),
})
