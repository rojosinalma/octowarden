import { listSets } from '../../services'
import { defineTool } from './define'

export const listSetsTool = defineTool({
  name: 'list_sets',
  description: 'Every set (ordered template names plus default values), stored and built-in (builtin: true).',
  inputSchema: {},
  destructive: false,
  readOnly: true,
  handler: async () => ({ sets: await listSets() }),
})
