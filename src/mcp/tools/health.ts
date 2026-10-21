import { authStatus } from '../../auth/providers'
import { pingDb } from '../../db'
import { rateLimits } from '../../github/client'
import { githubStatus } from '../../github/status'
import { schedulerStatus } from '../../lib/scheduler'
import { VERSION } from '../../lib/version'
import { activeBulkRuns } from '../../services'
import { defineTool } from './define'

export const health = defineTool({
  name: 'health',
  description:
    'Health snapshot: ok flag, DB reachability, version, GitHub auth {mode, source, login?/app_slug?} (never a secret), last seen GitHub rate limits, ' +
    'scheduler state (next and last audit), bulk runs in flight, and `github_access`: required versus granted GitHub permissions ' +
    '(rows with ok false are definite gaps, `missing` lists them as key:level, `permissions_url`/`install_url` fix them). Use it first when something looks wrong.',
  inputSchema: {},
  destructive: false,
  readOnly: true,
  handler: async () => {
    const db = await pingDb()
    const [github, access] = await Promise.all([authStatus(), githubStatus()])
    return { ok: db, db: db ? 'ok' : 'down', version: VERSION, github, github_access: access, rate_limits: rateLimits(), scheduler: schedulerStatus(), bulk_runs: activeBulkRuns() }
  },
})
