import type { AnyElysia } from 'elysia'
import { jsonOk } from '../../lib/json'
import { githubStatus, statusMessage } from '../../services'
import { flagParam } from './shared'

/** GitHub access: required versus granted permissions (`?refresh=1` asks GitHub now instead of the cache). */
export function routes(app: AnyElysia) {
  app
    .get('/github/status', async ({ query }) => {
      const status = await githubStatus({ refresh: flagParam((query as Record<string, string>).refresh) })
      return jsonOk(statusMessage(status), { status })
    })
    .post('/github/recheck', async () => {
      const status = await githubStatus({ refresh: true })
      return jsonOk(statusMessage(status), { status })
    })
}
