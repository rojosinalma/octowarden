import { getTemplate } from '../../services'
import { defineTool } from './define'
import { name } from './shared'

export const getTemplateTool = defineTool({
  name: 'get_template',
  description: 'One template by name: sections, requires, builtin flag, the sets that use it (used_by) and its YAML-ready document (doc).',
  inputSchema: { name },
  destructive: false,
  readOnly: true,
  handler: async (args) => ({ template: await getTemplate(args.name) }),
})
