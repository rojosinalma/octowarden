import { listSettings } from '../../services'
import { defineTool } from './define'

export const getSettingsTool = defineTool({
  name: 'get_settings',
  description: 'Every setting with its current value; secrets (tokens, keys, webhook URLs) show only as "set" or "".',
  inputSchema: {},
  destructive: false,
  readOnly: true,
  handler: async () => ({ settings: await listSettings() }),
})
