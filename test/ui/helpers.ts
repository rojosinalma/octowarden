// UI test bootstrap: core helpers (in-memory SQLite, fake GitHub) plus a request helper without a bearer token.
export { fresh, REPO, serveRepo, type World } from '../core/helpers'
import { createApp } from '../../src/app'
import type { FakeGitHub } from '../../src/github/fake'
import repoFixture from '../fixtures/repo.json'

let app: ReturnType<typeof createApp> | undefined

export type Res = { status: number; body: any; text: string; headers: Headers }

export async function req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
  app ??= createApp()
  const h: Record<string, string> = { ...headers }
  let payload: string | undefined
  if (typeof body === 'string') payload = body
  else if (body !== undefined) {
    payload = JSON.stringify(body)
    h['content-type'] ??= 'application/json'
  }
  const res = await app.handle(new Request(`http://localhost${path}`, { method, headers: h, body: payload }))
  const text = await res.text()
  let parsed: unknown = text
  try {
    parsed = JSON.parse(text)
  } catch {
    // HTML or YAML
  }
  return { status: res.status, body: parsed, text, headers: res.headers }
}

/** Repo list + identity routes the pages read, over the fixture (optionally with a hostile description). */
export function serveList(github: FakeGitHub, overrides: Record<string, unknown> = {}): void {
  const repo = { ...structuredClone(repoFixture), ...overrides }
  github.on('GET /user/repos', () => [repo])
  github.on('GET /user', () => ({ login: 'tester' }))
}

/** Payloads that break out of an attribute or a text node when not escaped (attributes escape `"`, text escapes `<`). */
export const XSS = '"><script>alert(1)</script>'
export const XSS_IMG = '"><img src=x onerror=alert(2)>'
