import type { AnyElysia } from 'elysia'
import { authStatus } from '../auth/providers'
import { pingDb } from '../db'
import type { AuthStatus } from '../auth/types'
import { VERSION } from '../lib/version'
import { peekGitHubStatus } from '../github/status'

const GITHUB_STATUS_TIMEOUT_MS = 3_000

async function github(): Promise<AuthStatus | { mode: string }> {
  let timer: Timer | undefined
  const timeout = new Promise<{ mode: string }>((resolve) => (timer = setTimeout(() => resolve({ mode: 'unknown' }), GITHUB_STATUS_TIMEOUT_MS)))
  const s = await Promise.race([authStatus(), timeout]).finally(() => clearTimeout(timer))
  // The cached access status only: /health never waits for a GitHub permission probe.
  const missing = peekGitHubStatus()?.missing
  const gaps = missing?.length ? { missing } : {}
  return 'source' in s ? { mode: s.mode, ...(s.login ? { login: s.login } : {}), ...(s.app_slug ? { app_slug: s.app_slug } : {}), ...gaps } : { ...s, ...gaps }
}

/** `GET /health`: 200 with DB ping ok, 503 when the DB fails. GitHub state (and `github.missing` from the cached access check) is informative, never red. */
export function register<A extends AnyElysia>(app: A): A {
  app.get('/health', async ({ set }) => {
    const dbOk = await pingDb()
    if (!dbOk) set.status = 503
    return { ok: dbOk, message: dbOk ? 'ok' : 'database unreachable', db: dbOk ? 'ok' : 'down', version: VERSION, github: await github() }
  })
  return app
}
