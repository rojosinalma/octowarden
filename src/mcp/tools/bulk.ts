import { z } from 'zod'
import { startBulk } from '../../services'
import { defineTool } from './define'
import { values } from './shared'

export const bulkTool = defineTool({
  name: 'bulk',
  description:
    'Plan, apply or audit many repos in the background (bounded concurrency). Returns run_id at once; poll get_run for per-repo results and totals. ' +
    'mode apply writes to GitHub but never applies destructive changes (they are skipped: apply them on the single repo with confirm). ' +
    'Without sets/templates each repo uses its assigned sets.',
  inputSchema: {
    repos: z.array(z.string()).min(1),
    mode: z.enum(['plan', 'apply', 'audit']),
    sets: z.array(z.string()).optional(),
    templates: z.array(z.string()).optional(),
    values: values.optional(),
  },
  destructive: true,
  readOnly: false,
  handler: async (args, ctx) => startBulk(args, ctx),
})
