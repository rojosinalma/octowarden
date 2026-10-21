import type { AnyElysia } from 'elysia'
import { jsonOk } from '../../lib/json'
import { listSettings, updateSettings } from '../../services'
import { bodyOf, ctx } from './shared'

export function routes(app: AnyElysia) {
  app
    .get('/settings', async () => jsonOk('ok', { settings: await listSettings() }))
    .put('/settings', async ({ body }) => {
      const patch = bodyOf(body) as Record<string, string>
      const settings = await updateSettings(patch, ctx)
      return jsonOk(`${Object.keys(patch).length} settings saved`, { settings })
    })
}
