// API test bootstrap: the core helpers (in-memory SQLite, fake GitHub) plus an app and a request helper.
export { fresh, REPO, serveRepo, TEST_ENV, type World } from '../core/helpers'
import { createApp } from '../../src/app'

export const TOKEN = 'test-api-token'
let app: ReturnType<typeof createApp> | undefined

export type Call = { status: number; body: any; headers: Headers; text: string }

/** `call('GET', '/api/templates')`; JSON bodies; bearer API token unless `token: null`. */
export async function call(method: string, path: string, body?: unknown, opts: { token?: string | null; headers?: Record<string, string> } = {}): Promise<Call> {
  app ??= createApp()
  const headers: Record<string, string> = { ...(opts.headers ?? {}) }
  const token = opts.token === undefined ? TOKEN : opts.token
  if (token) headers.authorization = `Bearer ${token}`
  let payload: string | undefined
  if (typeof body === 'string') payload = body
  else if (body !== undefined) {
    payload = JSON.stringify(body)
    headers['content-type'] ??= 'application/json'
  }
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers, body: payload }))
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // not JSON (YAML export, SSE)
  }
  return { status: res.status, body: parsed, headers: res.headers, text }
}

/** Waits until `fn` is truthy (background bulk runs). */
export async function until<T>(fn: () => Promise<T | undefined | null | false>, timeoutMs = 3000): Promise<T> {
  const end = Date.now() + timeoutMs
  for (;;) {
    const v = await fn()
    if (v) return v
    if (Date.now() > end) throw new Error('timed out')
    await Bun.sleep(10)
  }
}
