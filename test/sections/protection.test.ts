import { describe, expect, test } from 'bun:test'
import { fakeError } from '../../src/github/fake'
import { isPlanLimit } from '../../src/github/client'
import { protection, type ProtectionConfig } from '../../src/sections/protection'
import { ctxOf, fakeGitHub, fixture, notFound, OWNER, repo, writes } from './helpers'

async function world() {
  const gh = fakeGitHub()
  const main = await fixture('protection/main')
  gh.on('GET /repos/{owner}/{repo}/branches/{branch}/protection', (p) => {
    if (p.branch === 'main') return main
    if (p.branch === 'dev') return notFound('Branch not protected')
    return notFound('Branch not found')
  })
  gh.on('PUT /repos/{owner}/{repo}/branches/{branch}/protection', () => ({}))
  gh.on('POST /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures', () => ({ enabled: true }))
  gh.on('DELETE /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures', () => undefined)
  return gh
}

describe('protection section', () => {
  test('diff: noop on the recorded protection, update, create on an unprotected branch, skip a missing branch', async () => {
    const gh = await world()
    const desired: ProtectionConfig = {
      branches: [
        { branch: '~DEFAULT_BRANCH', required_status_checks: { strict: true, contexts: 'check' }, allow_force_pushes: false },
        { branch: 'dev', required_signatures: true, allow_deletions: false },
        { branch: 'gone', enforce_admins: true },
      ],
    }
    const changes = protection.diff(desired, await protection.read(ctxOf(gh), desired), repo)
    expect(changes.map((c) => [c.target, c.op, c.skip])).toEqual([
      ['main', 'noop', undefined],
      ['dev', 'create', undefined],
      ['gone', 'create', 'branch gone does not exist'],
    ])
    const upd = protection.diff({ branches: [{ branch: 'main', required_linear_history: true, required_signatures: true }] }, await protection.read(ctxOf(gh), { branches: [{ branch: 'main' }] }), repo)
    expect(upd[0]).toMatchObject({ op: 'update', destructive: false })
    // unset fields keep what the branch has
    expect((upd[0]!.after as { required_status_checks: unknown }).required_status_checks).toEqual({ strict: true, contexts: ['check'] })
  })

  test('apply: PUT the full body with restrictions null, then the signatures endpoint', async () => {
    const gh = await world()
    const desired: ProtectionConfig = {
      branches: [
        { branch: 'main', required_linear_history: true, required_signatures: true, required_pull_request_reviews: { required_approving_review_count: 1 } },
        { branch: 'dev', enforce_admins: true },
      ],
    }
    const changes = protection.diff(desired, await protection.read(ctxOf(gh), desired), repo).filter((c) => c.op !== 'noop')
    const results = await protection.apply(ctxOf(gh, repo, false), changes)
    expect(results.map((r) => r.message)).toEqual(['main protection updated', 'dev protection created'])
    expect(writes(gh)).toEqual([
      {
        route: 'PUT /repos/{owner}/{repo}/branches/{branch}/protection',
        params: {
          ...OWNER,
          branch: 'main',
          required_status_checks: { strict: true, contexts: ['check'] },
          enforce_admins: false,
          required_pull_request_reviews: { required_approving_review_count: 1, dismiss_stale_reviews: false, require_code_owner_reviews: false, require_last_push_approval: false },
          required_linear_history: true,
          allow_force_pushes: false,
          allow_deletions: false,
          required_conversation_resolution: false,
          restrictions: null,
        },
      },
      { route: 'POST /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures', params: { ...OWNER, branch: 'main' } },
      {
        route: 'PUT /repos/{owner}/{repo}/branches/{branch}/protection',
        params: {
          ...OWNER,
          branch: 'dev',
          required_status_checks: null,
          enforce_admins: true,
          required_pull_request_reviews: null,
          required_linear_history: false,
          allow_force_pushes: false,
          allow_deletions: false,
          required_conversation_resolution: false,
          restrictions: null,
        },
      },
    ])
  })

  test('empty contexts (from an empty value) turn status checks off', async () => {
    const gh = await world()
    const d: ProtectionConfig = { branches: [{ branch: 'main', required_status_checks: { contexts: '' } }] }
    const [c] = protection.diff(d, await protection.read(ctxOf(gh), d), repo)
    expect((c!.after as { required_status_checks: unknown }).required_status_checks).toBeNull()
  })

  test('private repo on Free: 403 on read is a plan limit; on apply a skip', async () => {
    const body = await fixture('rulesets/plan-limit-403')
    const gh = await world()
    gh.on('GET /repos/{owner}/{repo}/branches/{branch}/protection', () => {
      throw fakeError(403, body.message)
    })
    gh.on('PUT /repos/{owner}/{repo}/branches/{branch}/protection', () => {
      throw fakeError(403, body.message)
    })
    expect(isPlanLimit(await protection.read(ctxOf(gh), { branches: [{ branch: 'main' }] }).catch((e) => e))).toBe(true)
    const [r] = await protection.apply(ctxOf(gh, repo, false), [{ section: 'protection', op: 'create', target: 'main', after: {}, destructive: false }])
    expect(r!.outcome).toBe('skipped')
  })

  test('schema is strict', () => {
    expect(protection.schema.safeParse({ branches: [{ branch: 'main', restrictions: {} }] }).success).toBe(false)
    expect(protection.schema.safeParse({ branches: [{ branch: 'main', required_status_checks: null }] }).success).toBe(true)
  })
})
