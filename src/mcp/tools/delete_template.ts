import { deleteTemplate } from '../../services'
import { defineTool } from './define'
import { confirm, name } from './shared'

export const deleteTemplateTool = defineTool({
  name: 'delete_template',
  description: 'Delete a stored template. Destructive: needs confirm equal to the template name. Refused while a set lists it and for built-ins.',
  inputSchema: { name, confirm },
  destructive: true,
  readOnly: false,
  handler: async (args, ctx) => deleteTemplate(args.name, args.confirm, ctx),
})
