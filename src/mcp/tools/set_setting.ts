import { z } from 'zod'
import { updateSettings } from '../../services'
import { defineTool } from './define'

export const setSettingTool = defineTool({
  name: 'set_setting',
  description:
    'Change one setting (see get_settings for keys). Values are strings: integers as digits, booleans as true/false. Applies within seconds, no restart. ' +
    'Returns the settings with secrets masked.',
  inputSchema: { key: z.string().min(1).max(64), value: z.string().max(16_384) },
  destructive: false,
  readOnly: false,
  handler: async (args, ctx) => ({ settings: await updateSettings({ [args.key]: args.value }, ctx) }),
})
