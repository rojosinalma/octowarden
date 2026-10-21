import { deleteSet } from '../../services'
import { defineTool } from './define'
import { confirm, name } from './shared'

export const deleteSetTool = defineTool({
  name: 'delete_set',
  description: 'Delete a stored set. Destructive: needs confirm equal to the set name. Refused while repos have it assigned and for built-ins.',
  inputSchema: { name, confirm },
  destructive: true,
  readOnly: false,
  handler: async (args, ctx) => deleteSet(args.name, args.confirm, ctx),
})
