import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { createFakeGitHub, fakeError } from '../../src/github/fake'
import { setStatusAppFactory } from '../../src/github/status'
import { listEvents } from '../../src/lib/events'
import { allSettings, getSetting, setSetting } from '../../src/lib/settings'
import { setConversionClient } from '../../src/services'
import { setGitHubClient } from '../../src/auth/providers'
import conversion from '../fixtures/github/manifest-conversion.json'
import app from '../fixtures/github/app.json'
import installations from '../fixtures/github/installations.json'
import { fresh, req, serveList, type World } from './helpers'

let w: World

beforeEach(async () => {
  w = await fresh()
  serveList(w.github)
})

afterEach(() => {
  setConversionClient(undefined)
  setStatusAppFactory(undefined)
})

/** App credentials in settings, served by fakes with the recorded installations (one lacks pull requests and more). */
async function recordedApp() {
  setGitHubClient(undefined)
  await setSetting('github_auth_mode', 'app')
  await setSetting('github_app_id', '1234567')
  await setSetting('github_app_private_key', '-----BEGIN RSA PRIVATE KEY-----\nTEST\n-----END RSA PRIVATE KEY-----')
  const jwt = createFakeGitHub('app')
  jwt.on('GET /app', () => app)
  jwt.on('GET /app/installations', () => installations)
  const inst = createFakeGitHub('app')
  inst.on('GET /installation/repositories', () => ({ total_count: 3 }))
  setStatusAppFactory(() => ({ jwt, installation: () => inst }))
  return jwt
}

const manifestState = (html: string) => html.match(/id="manifest-form"[^>]*data-state="([^"]+)"/)?.[1] ?? html.match(/data-state="([^"]+)"[^>]*id="manifest-form"/)?.[1]

describe('settings: GitHub access', () => {
  test('App with gaps: danger badge, installations with their gaps and review links, danger rows, fix buttons', async () => {
    await recordedApp()
    const r = await req('GET', '/settings')
    expect(r.status).toBe(200)
    expect(r.text).toContain('data-github-state="4 missing"')
    expect(r.text).toContain('id="github-installations"')
    expect(r.text).toContain('data-installation="90000002"')
    expect(r.text).toContain('href="https://github.com/organizations/octo-org/settings/installations/90000002"')
    expect(r.text).toContain('Review on GitHub')
    expect(r.text).toContain('<tr data-permission="repository_hooks" data-tone="danger">')
    expect(r.text).toContain('<tr data-permission="administration">')
    expect(r.text).toContain('href="https://github.com/settings/apps/octoforge-app/permissions"')
    expect(r.text).toContain('Edit permissions on GitHub')
    expect(r.text).toContain('Accept on the installation')
    expect(r.text).toContain('data-action="github-recheck"')
    expect(r.text).toContain('href="https://github.com/settings/apps/octoforge-app"')
    // Sidebar counter on the GitHub entry of the settings sub-navigation.
    expect(r.text).toMatch(/href="\/settings#github"[\s\S]{0,400}data-github-gaps="4"/)
    // Other pages carry it on the Settings item once a check ran.
    expect((await req('GET', '/templates')).text).toContain('data-github-gaps="4"')
    // The App exists: the manifest block is collapsed.
    expect(r.text).toMatch(/<details class="t-card" data-variant="collapsible" id="github-manifest">/)
  })

  test('delivered by octoforge shows next to the mode', async () => {
    await recordedApp()
    await setSetting('github_credential_source', 'octoforge')
    const r = await req('GET', '/settings')
    expect(r.text).toContain('delivered by octoforge')
  })

  test('no credential: not configured, manifest open with JSON, copy button and the personal form', async () => {
    setGitHubClient(undefined)
    await setSetting('github_auth_mode', 'pat')
    const r = await req('GET', '/settings', undefined, { host: 'ow.example.test' })
    expect(r.text).toContain('data-github-state="not configured"')
    expect(r.text).toMatch(/id="github-manifest" open/)
    expect(r.text).toContain('class="t-code-copy"')
    expect(r.text).toContain('&quot;repository_hooks&quot;: &quot;write&quot;')
    expect(r.text).toContain('http://localhost/ui/github/app-created')
    expect(r.text).toMatch(/action="https:\/\/github.com\/settings\/apps\/new\?state=[A-Za-z0-9_-]+"/)
    expect(r.text).not.toContain('id="manifest-owner"')
    expect(r.text).not.toContain('data-github-gaps')
  })

  test('public_url drives the manifest URLs; token orgs fill the owner picker', async () => {
    await setSetting('public_url', 'https://warden.example.com')
    w.github.on('GET /user/orgs', () => [{ login: 'octo-org' }, { login: 'another-org' }])
    w.github.on('GET /user', () => ({ login: 'tester' }), { 'x-oauth-scopes': 'repo, admin:repo_hook, delete_repo, workflow, read:org' })
    const r = await req('GET', '/settings')
    expect(r.text).toContain('https://warden.example.com/ui/github/app-created')
    expect(r.text).toContain('id="manifest-owner"')
    expect(r.text).toContain('<option value="octo-org">octo-org (organization)</option>')
    expect(r.text).toContain('tester (personal account)')
    expect(r.text).toContain('data-github-state="ok"')
  })

  test('re-check action: fresh answer, block html, badge and gap count', async () => {
    const jwt = await recordedApp()
    await req('GET', '/settings')
    const r = await req('POST', '/ui/actions/github/recheck')
    expect(r.status).toBe(200)
    expect(r.body).toMatchObject({ ok: true, gaps: 4, message: 'GitHub access lacks pull_requests:write, repository_hooks:write, statuses:read, members:read' })
    expect(r.body.html).toContain('id="github-access"')
    expect(r.body.badge).toContain('id="github-state"')
    expect(jwt.calls.filter((c) => c.route === 'GET /app')).toHaveLength(2)
  })

  test('unreachable GitHub: warning, unknown rows, page still renders', async () => {
    w.github.on('GET /user', () => {
      throw fakeError(0, 'connect ECONNREFUSED')
    })
    const r = await req('GET', '/settings')
    expect(r.status).toBe(200)
    expect(r.text).toContain('data-github-state="unknown"')
    expect(r.text).toContain('GitHub could not be asked')
    expect(r.text).not.toMatch(/data-permission="[a-z_]+" data-tone="danger"/)
    expect(r.text).toContain('id="github-permissions"')
    expect(r.text).not.toMatch(/data-tone="(success|danger)">(write|read|none)</)
  })
})

describe('App from manifest: callback', () => {
  test('converts the code, stores id, key and secret, switches to app, shows the install link once', async () => {
    const gh = createFakeGitHub('none')
    gh.on('POST /app-manifests/{code}/conversions', () => conversion)
    setConversionClient(() => gh)
    const page = await req('GET', '/settings')
    const state = manifestState(page.text)
    expect(state).toBeDefined()
    const r = await req('GET', `/ui/github/app-created?code=abc123&state=${state}`)
    expect(r.status).toBe(200)
    expect(gh.calls).toEqual([{ route: 'POST /app-manifests/{code}/conversions', params: { code: 'abc123' } }])
    expect(r.text).toContain('GitHub App octowarden-example created.')
    expect(r.text).toContain('href="https://github.com/apps/octowarden-example/installations/new"')
    expect(r.text).toContain('data-toast="GitHub App octowarden-example created and stored"')
    expect(r.text).not.toContain('TEST-KEY-NOT-REAL')
    expect(r.text).not.toContain('test-webhook-secret-not-real')
    expect(await getSetting('github_app_id')).toBe('7654321')
    expect(await getSetting('github_app_private_key')).toContain('TEST-KEY-NOT-REAL')
    expect(await getSetting('github_webhook_secret')).toBe('test-webhook-secret-not-real')
    expect(await getSetting('github_auth_mode')).toBe('app')
    const events = await listEvents({ limit: 5 })
    expect(events.find((e) => e.action === 'github.app.create')?.message).toContain('octowarden-example')
    expect(JSON.stringify(events)).not.toContain('NOT-REAL')
    // The state is single-use.
    const again = await req('GET', `/ui/github/app-created?code=abc123&state=${state}`)
    expect(again.text).toContain('The App was not stored')
    expect(gh.calls).toHaveLength(1)
  })

  test('unknown state or bad code: nothing stored, GitHub not called', async () => {
    const gh = createFakeGitHub('none')
    setConversionClient(() => gh)
    const before = await allSettings()
    for (const q of ['code=abc&state=forged', 'state=x', 'code=a%20b&state=x']) {
      const r = await req('GET', `/ui/github/app-created?${q}`)
      expect(r.status).toBe(200)
      expect(r.text).toContain('data-toast-error=')
    }
    expect(gh.calls).toEqual([])
    expect(await allSettings()).toEqual(before)
  })

  test('GitHub refuses the code: reason shown, nothing stored', async () => {
    const gh = createFakeGitHub('none')
    gh.on('POST /app-manifests/{code}/conversions', () => {
      throw fakeError(404, 'Not Found')
    })
    setConversionClient(() => gh)
    const state = manifestState((await req('GET', '/settings')).text)
    const r = await req('GET', `/ui/github/app-created?code=expired&state=${state}`)
    expect(r.text).toContain('GitHub refused the App conversion (HTTP 404): Not Found')
    expect(await getSetting('github_app_id')).toBe('')
  })
})
