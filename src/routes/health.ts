import type { AnyElysia } from 'elysia'
import { authStatus } from '../auth/providers'
import { pingDb } from '../db'
import type { AuthStatus } from '../auth/types'
import { VERSION } from '../lib/version'

const GITHUB_STATUS_TIMEOUT_MS = 3_000

async function github(): Promise<AuthStatus | { mode: string }> {
  let timer: Timer | undefined
  const timeout = new Promise<{ mode: string }>((resolve) => (timer = setTimeout(() => resolve({ mode: 'unknown' }), GITHUB_STATUS_TIMEOUT_MS)))
  const s = await Promise.race([authStatus(), timeout]).finally(() => clearTimeout(timer))
  return 'source' in s ? { mode: s.mode, ...(s.login ? { login: s.login } : {}), ...(s.app_slug ? { app_slug: s.app_slug } : {}) } : s
}

/** `GET /health`: 200 with DB ping ok, 503 when the DB fails. GitHub state is informative, never red. */
export function register<A extends AnyElysia>(app: A): A {
  app.get('/health', async ({ set }) => {
    const dbOk = await pingDb()
    if (!dbOk) set.status = 503
    return { ok: dbOk, message: dbOk ? 'ok' : 'database unreachable', db: dbOk ? 'ok' : 'down', version: VERSION, github: await github() }
  })
  return app
}
