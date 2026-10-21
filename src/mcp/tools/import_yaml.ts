import { z } from 'zod'
import { importYaml } from '../../services'
import { defineTool } from './define'

export const importYamlTool = defineTool({
  name: 'import_yaml',
  description:
    'Import Template, Set and Manifest documents (YAML, --- separated). Templates and sets are created or replaced by name; manifests replace repo assignments. ' +
    'Everything is validated before the first write. Changes nothing on GitHub. Returns counts.',
  inputSchema: { yaml: z.string().max(5_000_000) },
  destructive: false,
  readOnly: false,
  handler: async (args, ctx) => ({ counts: await importYaml(args.yaml, ctx) }),
})
