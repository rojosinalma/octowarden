import { z } from 'zod'
import { getRun } from '../../services'
import { defineTool } from './define'

export const getRunTool = defineTool({
  name: 'get_run',
  description: 'One run (plan, apply, sync or audit): status (running|ok|failed|partial|drift), timestamps and summary (bulk runs: totals and per-repo results).',
  inputSchema: { id: z.string() },
  destructive: false,
  readOnly: true,
  handler: async (args) => ({ run: await getRun(args.id) }),
})
