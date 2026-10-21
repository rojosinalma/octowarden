import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fresh, REPO, req, serveList, type World } from './helpers'
import { createFakeGitHub, fakeError } from '../../src/github/fake'
import { setSetting } from '../../src/lib/settings'
import { setAppJwtFactory } from '../../src/routes/ui/lookups'

let w: World

beforeEach(async () => {
  w = await fresh()
  serveList(w.github)
})
afterEach(() => setAppJwtFactory(undefined))

describe('installation picker', () => {
  test('lists the App installations with the App JWT client', async () => {
    const jwt = createFakeGitHub('app')
    jwt.on('GET /app/installations', () => [
      { id: 22, account: { login: 'zeta-org', type: 'Organization' } },
      { id: 11, account: { login: 'alpha', type: 'User' } },
    ])
    let used: [string, string] | undefined
    setAppJwtFactory((id, key) => {
      used = [id, key]
      return jwt
    })
    await setSetting('github_app_id', '12345')
    await setSetting('github_app_private_key', '-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----')
    const r = await req('GET', '/ui/actions/github/installations')
    expect(r.body).toMatchObject({ ok: true, message: '2 installations found' })
    expect(r.body.installations).toEqual([
      { id: 11, account: 'alpha', type: 'user' },
      { id: 22, account: 'zeta-org', type: 'organization' },
    ])
    expect(used?.[0]).toBe('12345')
  })

  test('a GitHub failure comes back with its reason', async () => {
    const jwt = createFakeGitHub('app')
    jwt.on('GET /app/installations', () => {
      throw fakeError(401, 'A JSON web token could not be decoded')
    })
    setAppJwtFactory(() => jwt)
    await setSetting('github_app_id', '12345')
    await setSetting('github_app_private_key', 'key')
    const r = await req('GET', '/ui/actions/github/installations')
    expect(r.status).toBe(502)
    expect(r.body).toMatchObject({ ok: false, message: 'GitHub answered 401: A JSON web token could not be decoded' })
  })

  test('without App ID and key: 503 naming what is missing', async () => {
    const r = await req('GET', '/ui/actions/github/installations')
    expect(r.status).toBe(503)
    expect(r.body).toMatchObject({ ok: false, message: 'set the App ID and the App private key first' })
  })

  test('settings page renders the picker with Auto first and the stored value kept', async () => {
    await setSetting('github_app_installation_id', '777')
    const r = await req('GET', '/settings')
    expect(r.text).toContain('data-installations')
    expect(r.text).toContain('Auto: look up per repo owner')
    expect(r.text).toContain('#777 (stored)')
    expect(r.text).toContain('data-setting="github_app_installation_id"')
  })
})

describe('set lookups', () => {
  test('union of the assigned repos’ lookups', async () => {
    w.github.on('GET /repos/{owner}/{repo}/branches', () => [{ name: 'main' }, { name: 'dev' }])
    w.github.on('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', () => ({ check_runs: [{ name: 'build' }, { name: 'test' }] }))
    w.github.on('GET /repos/{owner}/{repo}/commits/{ref}/status', () => ({ statuses: [{ context: 'lint' }] }))
    w.github.on('GET /repos/{owner}/{repo}/environments', () => ({ environments: [{ name: 'prod' }] }))
    await req('PUT', '/ui/actions/repos/sets', { repo: REPO, sets: [{ set: 'house' }] })
    const r = await req('GET', '/ui/actions/sets/lookups?set=house')
    expect(r.body).toMatchObject({ ok: true, repos: [REPO], total: 1, failed: [] })
    expect(r.body.lookups).toEqual({ branches: ['dev', 'main'], checks: ['build', 'lint', 'test'], teams: [], environments: ['prod'] })
    const page = await req('GET', '/sets/house')
    expect(page.status).toBe(200)
  })

  test('a set with no repos answers empty lookups; the editor knows it has none', async () => {
    const r = await req('GET', '/ui/actions/sets/lookups?set=house')
    expect(r.body).toMatchObject({ ok: true, repos: [], total: 0 })
    const page = await req('GET', '/sets/new?from=house')
    expect(page.text).toContain('"assigned":0')
  })
})
