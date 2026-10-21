import { beforeEach, describe, expect, test } from 'bun:test'
import { setGitHubClient } from '../../src/auth/providers'
import { createFakeGitHub, fakeError } from '../../src/github/fake'
import { contractPermissions, gapsFor, githubStatus, peekGitHubStatus, probeGitHubStatus } from '../../src/github/status'
import { setSetting } from '../../src/lib/settings'
import { appWorld, fixture, fresh, tokenClient } from './helpers'

beforeEach(async () => {
  await fresh()
})

const row = (s: Awaited<ReturnType<typeof probeGitHubStatus>>, key: string) => s.permissions.find((p) => p.key === key)!

describe('GitHub App', () => {
  test('recorded installations: per-installation gaps, lowest grants in the rows, links', async () => {
    const w = await appWorld()
    const s = await probeGitHubStatus()
    expect(s.mode).toBe('app')
    expect(s.kind).toBe('app')
    expect(s.source).toBe('settings')
    expect(s.app_slug).toBe('octoforge-app')
    expect(s.app_url).toBe('https://github.com/settings/apps/octoforge-app')
    expect(s.permissions_url).toBe('https://github.com/settings/apps/octoforge-app/permissions')
    expect(s.new_install_url).toBe('https://github.com/apps/octoforge-app/installations/new')
    expect(s.app_missing).toEqual(['repository_hooks:write', 'statuses:read', 'members:read'])
    expect(s.installations).toEqual([
      {
        id: 90000001,
        account: 'octo-example',
        type: 'user',
        repository_selection: 'all',
        missing: ['repository_hooks:write', 'statuses:read', 'members:read'],
        url: 'https://github.com/settings/installations/90000001',
      },
      {
        id: 90000002,
        account: 'octo-org',
        type: 'org',
        repository_selection: 'selected',
        repo_count: 3,
        missing: ['issues:write', 'pull_requests:write', 'repository_hooks:write', 'statuses:read', 'members:read'],
        url: 'https://github.com/organizations/octo-org/settings/installations/90000002',
      },
    ])
    // The repo count costs one call on the "selected" installation only.
    expect(w.installations.has(90000001)).toBe(false)
    expect(w.installations.get(90000002)!.calls).toEqual([{ route: 'GET /installation/repositories', params: { per_page: 1 } }])
    expect(s.missing).toEqual(['issues:write', 'pull_requests:write', 'repository_hooks:write', 'statuses:read', 'members:read'])
    expect(s.ok).toBe(false)
    expect(row(s, 'repository_hooks')).toMatchObject({ granted: 'none', ok: false, sections: ['webhooks'] })
    expect(row(s, 'administration')).toMatchObject({ granted: 'write', ok: true })
    expect(s.install_url).toBe('https://github.com/settings/installations/90000001')
  })

  test('an App without issues:write but with pull_requests:write is satisfied via the alternative', async () => {
    const [one] = await fixture<unknown[]>('github/installations')
    await appWorld({ installations: [one] })
    const s = await probeGitHubStatus()
    expect(row(s, 'issues')).toMatchObject({ granted: 'none', ok: true, via: 'pull_requests:write' })
    expect(s.missing).toEqual(['repository_hooks:write', 'statuses:read', 'members:read'])
  })

  test('a pinned installation fills the rows; a pin that does not exist says so', async () => {
    await appWorld({ installationId: '90000001' })
    const pinned = await probeGitHubStatus()
    expect(pinned.installation_id).toBe(90000001)
    expect(pinned.missing).toEqual(['repository_hooks:write', 'statuses:read', 'members:read'])
    expect(pinned.install_url).toBe('https://github.com/settings/installations/90000001')
    await setSetting('github_app_installation_id', '42')
    const wrong = await probeGitHubStatus()
    expect(wrong.note).toContain('Installation 42')
  })

  test('an organization-owned App links to the organization settings', async () => {
    const app = { ...(await fixture('github/app')), owner: { login: 'octo-org', type: 'Organization' } }
    await appWorld({ app })
    const s = await probeGitHubStatus()
    expect(s.permissions_url).toBe('https://github.com/organizations/octo-org/settings/apps/octoforge-app/permissions')
  })

  test('no installation: not ok, a note, rows unknown', async () => {
    await appWorld({ installations: [] })
    const s = await probeGitHubStatus()
    expect(s.ok).toBe(false)
    expect(s.installations).toEqual([])
    expect(s.missing).toEqual([])
    expect(s.note).toContain('installed on no account')
    expect(s.permissions.every((p) => p.ok === null)).toBe(true)
  })

  test('unreachable GitHub: never throws, every row unknown, missing empty, error kept', async () => {
    await appWorld({ failApp: true })
    const s = await probeGitHubStatus()
    expect(s.error).toContain('ENOTFOUND')
    expect(s.missing).toEqual([])
    expect(s.ok).toBe(false)
    expect(s.permissions.every((p) => p.granted === 'unknown' && p.ok === null)).toBe(true)
    expect(s.installations).toBeUndefined()
  })

  test('gaps per repo owner: the owner installation decides', async () => {
    await appWorld()
    const s = await probeGitHubStatus()
    expect(gapsFor(s, 'octo-example').map((g) => g.reason)).toEqual(['GitHub App lacks repository_hooks:write', 'GitHub App lacks statuses:read', 'GitHub App lacks members:read'])
    expect(gapsFor(s, 'OCTO-ORG').map((g) => g.permission.key)).toEqual(['issues', 'pull_requests', 'repository_hooks', 'statuses', 'members'])
    // An owner without an installation falls back to the overall rows.
    expect(gapsFor(s, 'someone-else').length).toBe(5)
  })

  test('contractPermissions: what /api/octoforge/status carries', async () => {
    await appWorld()
    const s = await probeGitHubStatus()
    expect(contractPermissions(s)).toEqual({ missing: s.missing, permissions_url: 'https://github.com/settings/apps/octoforge-app/permissions', install_url: 'https://github.com/settings/installations/90000001' })
  })
})

describe('tokens', () => {
  test('classic token: scopes from x-oauth-scopes, gaps as token scopes', async () => {
    tokenClient('repo, workflow')
    const s = await probeGitHubStatus()
    expect(s.kind).toBe('pat-classic')
    expect(s.identity).toBe('tester')
    expect(s.granted_scopes).toEqual(['repo', 'workflow'])
    expect(s.missing_scopes).toEqual(['delete_repo', 'read:org'])
    expect(s.missing).toEqual(['members:read'])
    expect(s.permissions_url).toBe('https://github.com/settings/tokens')
    expect(gapsFor(s, 'octo-example').map((g) => g.reason)).toEqual(['token lacks scope read:org'])
    expect(s.ok).toBe(false)
  })

  test('classic token with every scope is ok', async () => {
    tokenClient('repo, admin:repo_hook, delete_repo, workflow, read:org')
    const s = await probeGitHubStatus()
    expect(s.ok).toBe(true)
    expect(s.missing).toEqual([])
  })

  test('fine-grained token: no scope header, rows unknown, nothing missing, a note', async () => {
    tokenClient(undefined)
    const s = await probeGitHubStatus()
    expect(s.kind).toBe('pat-fine-grained')
    expect(s.missing).toEqual([])
    expect(s.permissions.every((p) => p.ok === null)).toBe(true)
    expect(s.note).toContain('fine-grained')
    expect(s.permissions_url).toBe('https://github.com/settings/personal-access-tokens')
  })

  test('no credential at all (gh not consulted in pat mode): mode none', async () => {
    setGitHubClient(undefined)
    await setSetting('github_auth_mode', 'pat')
    const s = await probeGitHubStatus()
    expect(s.mode).toBe('none')
    expect(s.ok).toBe(false)
    expect(s.missing).toEqual([])
  })

  test('delivered by octoforge is reported', async () => {
    await setSetting('github_credential_source', 'octoforge')
    tokenClient('repo')
    const s = await probeGitHubStatus()
    expect(s.delivered).toBe(true)
    expect(s.source).toBe('octoforge')
  })
})

describe('cache', () => {
  test('reused within the TTL, asked again on refresh, on a credential change and after the TTL', async () => {
    const w = await appWorld()
    const count = () => w.jwt.calls.filter((c) => c.route === 'GET /app').length
    await githubStatus()
    await githubStatus()
    expect(count()).toBe(1)
    expect(peekGitHubStatus()?.app_slug).toBe('octoforge-app')
    await githubStatus({ refresh: true })
    expect(count()).toBe(2)
    await setSetting('github_app_installation_id', '90000001')
    expect((await githubStatus()).installation_id).toBe(90000001)
    expect(count()).toBe(3)
    await setSetting('github_status_ttl_min', '0')
    await githubStatus()
    expect(count()).toBe(4)
  })

  test('concurrent callers share one probe', async () => {
    const w = await appWorld()
    await Promise.all([githubStatus(), githubStatus(), githubStatus()])
    expect(w.jwt.calls.filter((c) => c.route === 'GET /app').length).toBe(1)
  })

  test('a forced client change drops the cache', async () => {
    const a = tokenClient('repo')
    await githubStatus()
    const b = createFakeGitHub('pat')
    b.on('GET /user', () => {
      throw fakeError(401, 'Bad credentials')
    })
    setGitHubClient(b)
    const s = await githubStatus()
    expect(s.error).toContain('Bad credentials')
    expect(a.calls.length).toBe(1)
  })
})
