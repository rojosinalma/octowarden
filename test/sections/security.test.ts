import { describe, expect, test } from 'bun:test'
import { fakeError } from '../../src/github/fake'
import { security } from '../../src/sections/security'
import { ctxOf, fakeGitHub, fixture, notFound, OWNER, privateRepo, repo, writes } from './helpers'

async function world(opts: { alerts?: boolean; repoOverrides?: Record<string, unknown> } = {}) {
  const sa = await fixture('security/security_and_analysis')
  const gh = fakeGitHub({ ...sa, ...opts.repoOverrides })
  gh.on('GET /repos/{owner}/{repo}/vulnerability-alerts', () => (opts.alerts ? undefined : notFound('Vulnerability alerts are disabled.')))
  gh.on('GET /repos/{owner}/{repo}/automated-security-fixes', () => fixture('security/automated-security-fixes'))
  gh.on('GET /repos/{owner}/{repo}/private-vulnerability-reporting', () => fixture('security/private-vulnerability-reporting'))
  for (const m of ['PUT', 'DELETE']) {
    for (const p of ['vulnerability-alerts', 'automated-security-fixes', 'private-vulnerability-reporting']) gh.on(`${m} /repos/{owner}/{repo}/${p}`, () => undefined)
  }
  gh.on('PATCH /repos/{owner}/{repo}', () => ({}))
  return gh
}

const ALL = {
  vulnerability_alerts: true,
  automated_security_fixes: true,
  secret_scanning: true,
  secret_scanning_push_protection: true,
  private_vulnerability_reporting: true,
}

describe('security section', () => {
  test('read maps toggles (204/404) and security_and_analysis', async () => {
    const gh = await world()
    const cur = await security.read(ctxOf(gh), ALL)
    expect(cur.values).toEqual({
      vulnerability_alerts: false,
      automated_security_fixes: false,
      secret_scanning: true,
      secret_scanning_push_protection: false,
      private_vulnerability_reporting: false,
    })
    expect(cur.unavailable).toEqual({})
    const on = await world({ alerts: true })
    expect((await security.read(ctxOf(on), { vulnerability_alerts: true })).values.vulnerability_alerts).toBe(true)
    // only the desired fields are read
    expect(on.calls.map((c) => c.route)).toEqual(['GET /repos/{owner}/{repo}/vulnerability-alerts'])
  })

  test('diff: update/noop per field, nothing destructive', async () => {
    const gh = await world()
    const changes = security.diff(ALL, await security.read(ctxOf(gh), ALL), repo)
    expect(changes.map((c) => [c.target, c.op])).toEqual([
      ['vulnerability_alerts', 'update'],
      ['automated_security_fixes', 'update'],
      ['secret_scanning', 'noop'],
      ['secret_scanning_push_protection', 'update'],
      ['private_vulnerability_reporting', 'update'],
    ])
    expect(changes.every((c) => !c.destructive && !c.skip)).toBe(true)
  })

  test('apply: one PATCH for security_and_analysis, alerts before fixes, PUT/DELETE toggles', async () => {
    const gh = await world()
    const changes = security
      .diff({ ...ALL, secret_scanning: false }, await security.read(ctxOf(gh), ALL), repo)
      .filter((c) => c.op !== 'noop')
    const results = await security.apply(ctxOf(gh, repo, false), changes)
    expect(results.map((r) => r.outcome)).toEqual(['applied', 'applied', 'applied', 'applied', 'applied'])
    expect(writes(gh)).toEqual([
      {
        route: 'PATCH /repos/{owner}/{repo}',
        params: { ...OWNER, security_and_analysis: { secret_scanning: { status: 'disabled' }, secret_scanning_push_protection: { status: 'enabled' } } },
      },
      { route: 'PUT /repos/{owner}/{repo}/vulnerability-alerts', params: OWNER },
      { route: 'PUT /repos/{owner}/{repo}/automated-security-fixes', params: OWNER },
      { route: 'PUT /repos/{owner}/{repo}/private-vulnerability-reporting', params: OWNER },
    ])
  })

  test('private repo without Advanced Security: secret scanning and PVR skipped with the reason', async () => {
    const gh = await world({ repoOverrides: { private: true, visibility: 'private' } })
    const changes = security.diff(ALL, await security.read(ctxOf(gh, privateRepo), ALL), privateRepo)
    const skipped = Object.fromEntries(changes.filter((c) => c.skip).map((c) => [c.target, c.skip]))
    expect(skipped).toEqual({
      secret_scanning_push_protection: 'secret scanning on a private repository needs GitHub Secret Protection (Advanced Security)',
      private_vulnerability_reporting: 'private vulnerability reporting is only available on public repositories',
    })
    // secret_scanning is already on: a noop, not a skip
    expect(changes.find((c) => c.target === 'secret_scanning')).toMatchObject({ op: 'noop' })
    expect(gh.calls.some((c) => c.route.includes('private-vulnerability-reporting'))).toBe(false)
  })

  test('no security_and_analysis (token without admin) → skipped, not failed', async () => {
    const gh = await world({ repoOverrides: { security_and_analysis: null } })
    const [c] = security.diff({ secret_scanning: false }, await security.read(ctxOf(gh), { secret_scanning: false }), repo)
    expect(c!.skip).toMatch(/admin access/)
  })

  test('a plan-limit answer on apply is skipped; other errors fail only their change', async () => {
    const gh = await world()
    gh.on('PATCH /repos/{owner}/{repo}', () => {
      throw fakeError(422, 'Secret scanning is not available for this repository.')
    })
    gh.on('PUT /repos/{owner}/{repo}/vulnerability-alerts', () => {
      throw fakeError(500, 'Server Error')
    })
    const changes = security.diff(ALL, await security.read(ctxOf(gh), ALL), repo).filter((c) => c.op !== 'noop')
    const results = await security.apply(ctxOf(gh, repo, false), changes)
    expect(results.map((r) => [r.change.target, r.outcome])).toEqual([
      ['secret_scanning_push_protection', 'skipped'],
      ['vulnerability_alerts', 'failed'],
      ['automated_security_fixes', 'applied'],
      ['private_vulnerability_reporting', 'applied'],
    ])
  })

  test('schema is strict', () => {
    expect(security.schema.safeParse({ secret_scanning: 'yes' }).success).toBe(false)
    expect(security.schema.safeParse({ dependabot: true }).success).toBe(false)
    expect(security.supports!({ ...repo, archived: true }).ok).toBe(false)
  })
})
