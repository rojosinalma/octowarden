import { listSectionInfo } from '../../services'
import { defineTool } from './define'

export const listSections = defineTool({
  name: 'list_sections',
  description:
    'Every template section (settings, security, rulesets, labels, …) with its title, description, the JSON Schema of its config and its mergeKey ' +
    '(arrays of objects merge by that key across templates). Read this before writing a template.',
  inputSchema: {},
  destructive: false,
  readOnly: true,
  handler: async () => ({ sections: listSectionInfo() }),
})
