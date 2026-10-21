import { z } from 'zod'
import { listRuns } from '../../services'
import { defineTool } from './define'

export const listRunsTool = defineTool({
  name: 'list_runs',
  description: 'Recent runs, newest first (default 50, max 200), optionally of one kind.',
  inputSchema: { limit: z.number().int().min(1).max(200).optional(), kind: z.enum(['plan', 'apply', 'sync', 'audit']).optional() },
  destructive: false,
  readOnly: true,
  handler: async (args) => ({ runs: await listRuns(args) }),
})
