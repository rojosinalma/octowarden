import { timingSafeEqual } from 'node:crypto'
import { errBody } from '../lib/json'

type Secret = string | undefined | (() => string | undefined)

function digest(s: string): Buffer {
  return Buffer.from(new Bun.CryptoHasher('sha256').update(s).digest())
}

/** Constant-time string compare (hashes first so lengths never leak). */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b))
}

/** `Authorization: Bearer <token>` → token. */
export function bearerToken(header: string | null | undefined): string | undefined {
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')
  return m?.[1]
}

export type GuardOptions = {
  /** Variable name for the message, e.g. `API_TOKEN`. */
  name: string
  /** Status while the token is unset: 503 for /api and /mcp, 404 for /api/octoforge (contract). */
  unsetStatus?: 503 | 404
}

export type GuardContext = { request: Request; set: { status?: number | string; headers: Record<string, string | number> } }
export type GuardFailure = { ok: false; message: string; code: string }

/**
 * Elysia `beforeHandle` guard, fail-closed. Token unset → 503 "<name> not configured" (or 404 for octoforge);
 * missing/wrong bearer → 401. `expected` may be a getter so it is read at request time.
 * Usage: `app.guard({ beforeHandle: requireBearer(() => config().apiToken) }, (g) => g.get(...))`.
 */
export function requireBearer(expected: Secret, opts: GuardOptions = { name: 'API_TOKEN' }) {
  return ({ request, set }: GuardContext): GuardFailure | undefined => {
    const token = typeof expected === 'function' ? expected() : expected
    if (!token) {
      set.status = opts.unsetStatus ?? 503
      return opts.unsetStatus === 404 ? errBody('not found', 'not_found') : errBody(`${opts.name} not configured`, 'unavailable')
    }
    const given = bearerToken(request.headers.get('authorization'))
    if (!given || !safeEqual(given, token)) {
      set.status = 401
      set.headers['www-authenticate'] = 'Bearer'
      return errBody('unauthorized', 'unauthorized')
    }
    return undefined
  }
}
