import { authStatus } from '../../auth/providers'
import { pingDb } from '../../db'
import { rateLimits } from '../../github/client'
import { schedulerStatus } from '../../lib/scheduler'
import { VERSION } from '../../lib/version'
import { activeBulkRuns } from '../../services'
import { defineTool } from './define'

export const health = defineTool({
  name: 'health',
  description:
    'Health snapshot: ok flag, DB reachability, version, GitHub auth {mode, source, login?/app_slug?} (never a secret), last seen GitHub rate limits, ' +
    'scheduler state (next and last audit) and bulk runs in flight. Use it first when something looks wrong.',
  inputSchema: {},
  destructive: false,
  readOnly: true,
  handler: async () => {
    const db = await pingDb()
    return { ok: db, db: db ? 'ok' : 'down', version: VERSION, github: await authStatus(), rate_limits: rateLimits(), scheduler: schedulerStatus(), bulk_runs: activeBulkRuns() }
  },
})
