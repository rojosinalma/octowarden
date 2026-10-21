import { z } from 'zod'
import { startAudit } from '../../services'
import { defineTool } from './define'

export const auditTool = defineTool({
  name: 'audit',
  description:
    'Drift audit in the background: compares repos (default: every repo with assigned sets) with their assigned sets and stores drift_state. ' +
    'Reads GitHub only. Returns run_id; poll get_run.',
  inputSchema: { repos: z.array(z.string()).optional() },
  destructive: false,
  readOnly: false,
  handler: async (args, ctx) => startAudit(args, ctx),
})
