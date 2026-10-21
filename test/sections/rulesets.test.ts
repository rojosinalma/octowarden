import { describe, expect, test } from 'bun:test'
import { fakeError } from '../../src/github/fake'
import { isPlanLimit } from '../../src/github/client'
import { rulesets, toApi, type RulesetsConfig } from '../../src/sections/rulesets'
import { ctxOf, fakeGitHub, fixture, notFound, OWNER, repo, writes } from './helpers'

async function world(opts: { branches?: string[] } = {}) {
  const gh = fakeGitHub()
  const list = await fixture('rulesets/list')
  gh.on('GET /repos/{owner}/{repo}/rulesets', () => list)
  gh.on('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}', (p) => fixture(`rulesets/detail-${p.ruleset_id}`))
  gh.on('GET /repos/{owner}/{repo}/branches/{branch}', (p) => ((opts.branches ?? ['main']).includes(String(p.branch)) ? { name: p.branch } : notFound('Branch not found')))
  gh.on('POST /repos/{owner}/{repo}/rulesets', () => ({ id: 4100009 }))
  gh.on('PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}', () => ({}))
  gh.on('DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}', () => undefined)
  return gh
}

const protectMain = (contexts: string | string[] = 'check') => ({
  name: 'protect-main',
  rules: { deletion: true, non_fast_forward: true, required_signatures: true, required_status_checks: { contexts } },
  bypass_actors: ['admin' as const],
})

describe('rulesets section', () => {
  test('toApi: defaults, ref names, admin shorthand, comma-separated checks, empty checks drop the rule', () => {
    const api = toApi({ ...protectMain('check, lint'), conditions: { ref_name: { include: ['main', '~DEFAULT_BRANCH'] } } })
    expect(api).toEqual({
      name: 'protect-main',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { include: ['refs/heads/main', '~DEFAULT_BRANCH'].sort(), exclude: [] } },
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        { type: 'required_signatures' },
        { type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'check' }, { context: 'lint' }], strict_required_status_checks_policy: false } },
      ],
      bypass_actors: [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }],
    })
    expect(toApi(protectMain('')).rules.map((r) => r.type)).toEqual(['deletion', 'non_fast_forward', 'required_signatures'])
    expect(toApi({ name: 't', target: 'tag', conditions: { ref_name: { include: ['v*'] } }, rules: {} }).conditions.ref_name.include).toEqual(['refs/tags/v*'])
  })

  test('diff: recorded ruleset with extra GitHub fields (integration_id, do_not_enforce_on_create) is a noop', async () => {
    const gh = await world()
    const desired: RulesetsConfig = { rulesets: [protectMain()] }
    const changes = rulesets.diff(desired, await rulesets.read(ctxOf(gh), desired), repo)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ op: 'noop', target: 'protect-main', destructive: false })
    expect(gh.calls.map((c) => c.route)).toEqual([
      'GET /repos/{owner}/{repo}/rulesets',
      'GET /repos/{owner}/{repo}/rulesets/{ruleset_id}',
      'GET /repos/{owner}/{repo}/rulesets/{ruleset_id}',
    ])
    expect(gh.calls[0]!.params).toEqual({ ...OWNER, includes_parents: false })
  })

  test('diff: update, create, prune → destructive delete', async () => {
    const gh = await world()
    const desired: RulesetsConfig = {
      prune: true,
      rulesets: [{ ...protectMain(), rules: { ...protectMain().rules, pull_request: {} } }, { name: 'tags', target: 'tag', rules: { deletion: true } }],
    }
    const changes = rulesets.diff(desired, await rulesets.read(ctxOf(gh), desired), repo)
    expect(changes.map((c) => [c.op, c.target, c.destructive])).toEqual([
      ['update', 'protect-main', false],
      ['create', 'tags', false],
      ['delete', 'legacy-tags', true],
    ])
    const update = changes[0]!
    expect((update.after as { rules: { type: string }[] }).rules.map((r) => r.type)).toContain('pull_request')
    // without prune nothing is deleted
    expect(rulesets.diff({ rulesets: desired.rulesets }, await rulesets.read(ctxOf(gh)), repo).some((c) => c.op === 'delete')).toBe(false)
  })

  test('apply: POST / PUT by id / DELETE by id with the exact bodies', async () => {
    const gh = await world()
    const desired: RulesetsConfig = { prune: true, rulesets: [protectMain('check,lint'), { name: 'tags', target: 'tag', rules: { deletion: true } }] }
    const changes = rulesets.diff(desired, await rulesets.read(ctxOf(gh), desired), repo).filter((c) => c.op !== 'noop')
    gh.calls.length = 0
    const results = await rulesets.apply(ctxOf(gh, repo, false), changes)
    expect(results.map((r) => [r.outcome, r.message])).toEqual([
      ['applied', 'ruleset protect-main updated'],
      ['applied', 'ruleset tags created (id 4100009)'],
      ['applied', 'ruleset legacy-tags deleted'],
    ])
    expect(writes(gh)).toEqual([
      { route: 'PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}', params: { ...OWNER, ruleset_id: 4100001, ...toApi(protectMain('check,lint')) } },
      {
        route: 'POST /repos/{owner}/{repo}/rulesets',
        params: {
          ...OWNER,
          name: 'tags',
          target: 'tag',
          enforcement: 'active',
          conditions: { ref_name: { include: ['~DEFAULT_BRANCH'], exclude: [] } },
          rules: [{ type: 'deletion' }],
          bypass_actors: [],
        },
      },
      { route: 'DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}', params: { ...OWNER, ruleset_id: 4100002 } },
    ])
  })

  test('if_branch_exists: a missing branch skips the ruleset with the reason', async () => {
    const gh = await world({ branches: ['main'] })
    const desired: RulesetsConfig = { rulesets: [{ ...protectMain(), name: 'protect-dev', if_branch_exists: true, conditions: { ref_name: { include: ['dev'] } } }] }
    const [c] = rulesets.diff(desired, await rulesets.read(ctxOf(gh), desired), repo)
    expect(c).toMatchObject({ op: 'create', skip: 'branch dev does not exist' })
    const withDev = await world({ branches: ['main', 'dev'] })
    const [d] = rulesets.diff(desired, await rulesets.read(ctxOf(withDev), desired), repo)
    expect(d!.skip).toBeUndefined()
  })

  test('private repo on Free: the recorded 403 is a plan limit (read) and a skip (apply)', async () => {
    const body = await fixture('rulesets/plan-limit-403')
    const gh = await world()
    gh.on('GET /repos/{owner}/{repo}/rulesets', () => {
      throw fakeError(403, body.message)
    })
    const err = await rulesets.read(ctxOf(gh)).catch((e) => e)
    expect(isPlanLimit(err)).toBe(true)
    gh.on('POST /repos/{owner}/{repo}/rulesets', () => {
      throw fakeError(403, body.message)
    })
    const [r] = await rulesets.apply(ctxOf(gh, repo, false), [{ section: 'rulesets', op: 'create', target: 'x', after: toApi(protectMain()), destructive: false }])
    expect(r).toMatchObject({ outcome: 'skipped', message: body.message })
  })

  test('schema: strict, rejects unknown rules and bad enforcement', () => {
    expect(rulesets.schema.safeParse({ rulesets: [protectMain()] }).success).toBe(true)
    expect(rulesets.schema.safeParse({ rulesets: [{ name: 'x', rules: { merge_queue: true } }] }).success).toBe(false)
    expect(rulesets.schema.safeParse({ rulesets: [{ name: 'x', rules: {}, enforcement: 'on' }] }).success).toBe(false)
    expect(rulesets.mergeKey).toBe('name')
  })
})
