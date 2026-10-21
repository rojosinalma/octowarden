import { listTemplates } from '../../services'
import { defineTool } from './define'

export const listTemplatesTool = defineTool({
  name: 'list_templates',
  description: 'Every template: stored ones and the read-only built-in starter templates (builtin: true), each with its sections and requires.visibility.',
  inputSchema: {},
  destructive: false,
  readOnly: true,
  handler: async () => ({ templates: await listTemplates() }),
})
