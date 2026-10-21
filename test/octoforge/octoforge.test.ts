import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { VERSION } from '../../src/lib/version'
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// verifyCredential talks to GitHub; the mock answers like it for a known token / App id.
mock.module('../../src/auth/verify', () => ({
  verifyCredential: async (input: { mode: string; token?: string; app_id?: string }) => {
    if (input.mode === 'pat') {
      if (input.token !== 'ghp_good') {
        const { ValidationError } = await import('../../src/lib/json')
        throw new ValidationError('GitHub rejected the token: Bad credentials (HTTP 401)')
      }
      return { login: 'octocat' }
    }
    return { app_slug: 'octowarden-test' }
  },
}))

const { createApp } = await import('../../src/app')
const { openDb, tableCounts } = await import('../../src/db')
const { getSetting } = await import('../../src/lib/settings')
const { fresh } = await import('../core/helpers')
const manifestFile = JSON.parse(readFileSync(join(import.meta.dir, '../../octoforge.json'), 'utf8'))

const TOKEN = 'forge-token'
let dir: string
let app: ReturnType<typeof createApp>

async function req(method: string, path: string, body?: unknown, token: string | null = TOKEN) {
  const headers: Record<string, string> = {}
  if (token) headers.authorization = `Bearer ${token}`
  if (body !== undefined) headers['content-type'] = 'application/json'
  const res = await app.handle(new Request(`http://localhost/api/octoforge${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }))
  const text = await res.text()
  return { status: res.status, body: JSON.parse(text), text }
}

beforeEach(async () => {
  dir = mkdtempSync(join(tmpdir(), 'ow-forge-'))
  await fresh({ DATA_DIR: dir, OCTOFORGE_TOKEN: TOKEN })
  app = createApp()
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('octoforge contract v1', () => {
  test('404 on every route while OCTOFORGE_TOKEN is unset', async () => {
    await fresh({ DATA_DIR: dir })
    for (const [m, p] of [['GET', '/manifest'], ['GET', '/status'], ['PUT', '/github'], ['DELETE', '/github'], ['POST', '/database/adopt'], ['DELETE', '/database'], ['PUT', '/siblings'], ['DELETE', '/siblings']]) {
      const r = await req(m!, p!, m === 'PUT' || m === 'POST' ? { x: 1 } : undefined)
      expect(r.status).toBe(404)
    }
  })

  test('401 with a wrong or missing bearer; manifest needs none', async () => {
    expect((await req('GET', '/status', undefined, 'wrong')).status).toBe(401)
    expect((await req('GET', '/status', undefined, null)).status).toBe(401)
    expect((await req('PUT', '/github', 'not json', 'wrong')).status).toBe(401)
    const m = await req('GET', '/manifest', undefined, null)
    expect(m.status).toBe(200)
    expect(m.body).toEqual(manifestFile)
  })

  test('status', async () => {
    const r = await req('GET', '/status')
    expect(r.body).toMatchObject({ ok: true, contract: 1, version: VERSION, database: { engine: 'sqlite', source: 'env' } })
    for (const k of Object.keys(r.body.github)) expect(['mode', 'source', 'app_id', 'login', 'missing', 'permissions_url', 'install_url']).toContain(k)
  })

  test('status: github.missing and permissions_url from the access check (definite gaps only)', async () => {
    const { setGitHubClient } = await import('../../src/auth/providers')
    const { createFakeGitHub } = await import('../../src/github/fake')
    const { invalidateGitHubStatus } = await import('../../src/github/status')
    const gh = createFakeGitHub('pat')
    gh.on('GET /user', () => ({ login: 'tester' }), { 'x-oauth-scopes': 'repo, workflow' })
    setGitHubClient(gh)
    invalidateGitHubStatus()
    try {
      const r = await req('GET', '/status')
      // a classic token with repo + workflow lacks only read:org (team picker)
      expect(r.body.github.missing).toEqual(['members:read'])
      expect(r.body.github.permissions_url).toStartWith('https://github.com/settings/')
      expect(r.text).not.toContain('ghp_')
    } finally {
      setGitHubClient(undefined)
      invalidateGitHubStatus()
    }
  })

  test('PUT/DELETE github: stored in settings, never echoed', async () => {
    let r = await req('PUT', '/github', { mode: 'pat', token: 'ghp_bad' })
    expect(r.status).toBe(422)
    r = await req('PUT', '/github', { mode: 'pat', token: 'ghp_good' })
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, login: 'octocat', restart_required: false })
    expect(r.text).not.toContain('ghp_good')
    expect(await getSetting('github_token')).toBe('ghp_good')
    expect(await getSetting('github_credential_source')).toBe('octoforge')
    expect(await getSetting('github_auth_mode')).toBe('pat')

    r = await req('PUT', '/github', { mode: 'app', app_id: 12345, private_key: '-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----', webhook_secret: 'whs', installation_id: '9' })
    expect(r.body).toMatchObject({ ok: true, app_slug: 'octowarden-test', restart_required: false })
    expect(r.text).not.toContain('PRIVATE KEY')
    expect(await getSetting('github_app_id')).toBe('12345')
    expect(await getSetting('github_auth_mode')).toBe('app')

    r = await req('DELETE', '/github')
    expect(r.body).toMatchObject({ ok: true, removed: true, restart_required: false })
    expect(await getSetting('github_app_private_key')).toBe('')
    expect(await getSetting('github_credential_source')).toBe('')
    expect(await getSetting('github_auth_mode')).toBe('auto')
    expect((await req('DELETE', '/github')).body.removed).toBe(false)
  })

  test('adopt SQLite → SQLite: row counts, 0600 file, DELETE /database', async () => {
    // Some rows to copy.
    await createApp().handle(
      new Request('http://localhost/api/templates/wiki', {
        method: 'PUT',
        headers: { authorization: 'Bearer test-api-token', 'content-type': 'application/json' },
        body: JSON.stringify({ apiVersion: 'octowarden/v1', kind: 'Template', metadata: { name: 'wiki' }, spec: { sections: { settings: { has_wiki: true } } } }),
      }),
    )
    const target = join(dir, 'shared', 'octowarden.db')
    const r = await req('POST', '/database/adopt', { url: `sqlite:${target}`, schema: 'octowarden', copy: true })
    expect(r.status).toBe(200)
    expect(r.body.restart_required).toBe(true)
    expect(r.body.tables.templates).toBe(1)
    expect(r.body.tables.settings).toBeGreaterThan(10)

    const t = await openDb(`sqlite:${target}`, 'octowarden', { migrate: false })
    expect(await tableCounts(t)).toEqual(r.body.tables)
    await t.close()

    const file = join(dir, 'octoforge-database.json')
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ url: `sqlite:${target}`, schema: 'octowarden' })

    expect((await req('DELETE', '/database')).body).toMatchObject({ ok: true, removed: true, restart_required: true })
    expect(() => statSync(file)).toThrow()
  })

  test('adopt refuses the database in use and bad bodies', async () => {
    expect((await req('POST', '/database/adopt', { url: 'mysql://x', schema: 'a' })).status).toBe(422)
    expect((await req('POST', '/database/adopt', { url: 'sqlite::memory:', schema: 'a' })).status).toBe(422)
    expect((await req('POST', '/database/adopt', { url: 'sqlite:x', schema: 'a', extra: 1 })).status).toBe(422)
  })

  test.skipIf(!Bun.env.TEST_POSTGRES_URL)('adopt SQLite → Postgres', async () => {
    const schema = `ow_adopt_${Date.now().toString(36)}`
    const r = await req('POST', '/database/adopt', { url: Bun.env.TEST_POSTGRES_URL!, schema, copy: true })
    expect(r.status).toBe(200)
    const t = await openDb(Bun.env.TEST_POSTGRES_URL!, schema, { migrate: false })
    try {
      expect(await tableCounts(t)).toEqual(r.body.tables)
      expect(t.engine).toBe('postgres')
    } finally {
      const { sql } = await import('kysely')
      await sql.raw(`drop schema "${schema}" cascade`).execute(t.kysely)
      await t.close()
    }
    expect(r.text).not.toContain(':x@')
  })

  test('PUT/DELETE siblings: stored, validated, rendered as a switcher, cleared', async () => {
    const list = {
      forge: { title: 'Octoforge', url: 'https://forge.example.com', icon: 'https://forge.example.com/favicon.svg' },
      members: [
        { name: 'octotally', title: 'Octotally', url: 'https://tally.example.com', icon: 'https://tally.example.com/favicon.svg' },
        { name: 'octowarden', title: 'Octowarden', url: 'https://warden.example.com', icon: 'https://warden.example.com/favicon.svg' },
      ],
      updated_at: '2026-10-21T12:00:00Z',
    }
    expect((await req('PUT', '/siblings', list, 'wrong')).status).toBe(401)
    expect((await req('PUT', '/siblings', { ...list, forge: { title: 'x', url: 'javascript:alert(1)' } })).status).toBe(422)
    const r = await req('PUT', '/siblings', list)
    expect(r.body).toMatchObject({ ok: true, message: 'sibling list stored (2 members)' })
    let page = await (await app.handle(new Request('http://localhost/templates'))).text()
    expect(page).toContain('href="https://forge.example.com"')
    expect(page).toContain('href="https://tally.example.com"')
    // the receiving member is marked, not linked
    expect(page).not.toContain('href="https://warden.example.com"')
    expect(page).toContain('data-sibling="octowarden"')
    expect((await req('DELETE', '/siblings')).body).toMatchObject({ ok: true, removed: true })
    page = await (await app.handle(new Request('http://localhost/templates'))).text()
    expect(page).not.toContain('data-sibling')
  })

  test('siblings: no switcher without OCTOFORGE_TOKEN even when a list is stored', async () => {
    const { setSetting } = await import('../../src/lib/settings')
    await setSetting('octoforge_siblings', JSON.stringify({ forge: { title: 'Octoforge', url: 'https://forge.example.com' }, members: [], received_at: new Date().toISOString() }))
    await fresh({ DATA_DIR: dir })
    await setSetting('octoforge_siblings', JSON.stringify({ forge: { title: 'Octoforge', url: 'https://forge.example.com' }, members: [], received_at: new Date().toISOString() }))
    const page = await (await createApp().handle(new Request('http://localhost/templates'))).text()
    expect(page).not.toContain('data-sibling')
  })

  test('siblings: hidden once Octoforge has not re-sent the list for siblings_stale_min', async () => {
    const { siblingView, storeSiblings } = await import('../../src/lib/siblings')
    await storeSiblings({ forge: { title: 'Octoforge', url: 'https://forge.example.com' }, members: [] })
    expect(await siblingView()).toBeDefined()
    expect(await siblingView(Date.now() + 181 * 60_000)).toBeUndefined()
  })
})
