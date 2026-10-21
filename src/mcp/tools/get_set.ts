import { getSet } from '../../services'
import { defineTool } from './define'
import { name } from './shared'

export const getSetTool = defineTool({
  name: 'get_set',
  description: 'One set by name: templates in apply order, default values, the repos it is assigned to and its YAML-ready document (doc).',
  inputSchema: { name },
  destructive: false,
  readOnly: true,
  handler: async (args) => ({ set: await getSet(args.name) }),
})
