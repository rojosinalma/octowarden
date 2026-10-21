// Auth tests: a fetch stub standing in for api.github.com, generated RSA keys, config without secrets on disk.
import { generateKeyPairSync } from 'node:crypto'
import { closeDb } from '../../src/db'
import { loadConfig, setConfig } from '../../src/lib/config'
import { setLogLevel } from '../../src/lib/log'
import { resetSettingsCache } from '../../src/lib/settings'

setLogLevel(Bun.env.TEST_LOG_LEVEL ?? 'error')

export type Seen = { method: string; path: string; authorization: string; body?: unknown }
type Route = (req: Seen) => { status?: number; body?: unknown } | undefined

const realFetch = globalThis.fetch

/** Replaces fetch: `routes['GET /app']` answers (a body, `{status, body}` or a function); unknown routes answer 404. Returns the request log. */
export function stubGitHub(routes: Record<string, Route | object>): Seen[] {
  const seen: Seen[] = []
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
    const headers = (init?.headers ?? {}) as Record<string, string>
    const req: Seen = {
      method: (init?.method ?? 'GET').toUpperCase(),
      path: url.pathname,
      authorization: headers.authorization ?? headers.Authorization ?? '',
      body: typeof init?.body === 'string' && init.body ? JSON.parse(init.body) : undefined,
    }
    seen.push(req)
    const route = routes[`${req.method} ${req.path}`]
    const isResponse = (r: object) => !Array.isArray(r) && 'status' in r && 'body' in r
    const out = typeof route === 'function' ? (route as Route)(req) : route ? (isResponse(route) ? (route as { status: number; body: unknown }) : { body: route }) : undefined
    const status = out?.status ?? (out ? 200 : 404)
    const body = out?.body ?? (out ? {} : { message: 'Not Found' })
    const res = new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '4999' } })
    // A real fetch answer carries its URL; Octokit's pagination reads it.
    Object.defineProperty(res, 'url', { value: url.href })
    return res
  }) as typeof fetch
  return seen
}

export function restoreFetch(): void {
  globalThis.fetch = realFetch
}

export function rsaKeys(format: 'pkcs8' | 'pkcs1' = 'pkcs8'): { privateKey: string; publicKey: string } {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: format, format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
  })
  return { privateKey, publicKey }
}

/** Config from env only (no DB): settings fall back to defaults, env wins. */
export async function envOnly(env: Record<string, string> = {}): Promise<void> {
  await closeDb()
  resetSettingsCache()
  setConfig(loadConfig({ DATA_DIR: '/nonexistent-octowarden-test', DATABASE_URL: 'sqlite::memory:', LOG_LEVEL: 'error', ...env }))
}

export function decodeJwt(token: string): { header: Record<string, unknown>; payload: Record<string, unknown>; signed: string; signature: Buffer } {
  const [h, p, s] = token.split('.') as [string, string, string]
  const dec = (x: string) => JSON.parse(Buffer.from(x, 'base64url').toString())
  return { header: dec(h), payload: dec(p), signed: `${h}.${p}`, signature: Buffer.from(s, 'base64url') }
}
