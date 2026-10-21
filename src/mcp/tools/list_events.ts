import { z } from 'zod'
import { listEvents, OUTCOMES, SOURCES } from '../../services'
import { defineTool } from './define'

export const listEventsTool = defineTool({
  name: 'list_events',
  description:
    'Audit trail, newest first (default 100, max 500): who (actor, source), repo, section, action, outcome, redacted diff, message. ' +
    'Filter by repo, section, source, actor, outcome, run_id or since (ISO time).',
  inputSchema: {
    repo: z.string().optional(),
    section: z.string().optional(),
    source: z.enum(SOURCES).optional(),
    actor: z.string().optional(),
    outcome: z.enum(OUTCOMES).optional(),
    run_id: z.string().optional(),
    since: z.string().optional(),
    limit: z.number().int().min(1).max(500).optional(),
  },
  destructive: false,
  readOnly: true,
  handler: async (args) => ({ events: await listEvents(args) }),
})
