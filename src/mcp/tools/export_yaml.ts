import { z } from 'zod'
import { exportYaml } from '../../services'
import { defineTool } from './define'

export const exportYamlTool = defineTool({
  name: 'export_yaml',
  description:
    'Templates and sets as multi-document YAML (apiVersion octowarden/v1). No names = every stored template and set; manifest: true adds the repo assignments. ' +
    'Secret-looking values are replaced by placeholders or left out. Returns the YAML text.',
  inputSchema: { templates: z.array(z.string()).optional(), sets: z.array(z.string()).optional(), manifest: z.boolean().optional() },
  destructive: false,
  readOnly: true,
  handler: async (args) => exportYaml(args),
})
