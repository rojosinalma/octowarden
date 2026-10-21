import { afterEach, describe, expect, test } from 'bun:test'
import { fakeError } from '../../src/github/fake'
import { labels } from '../../src/sections/labels'
import { topics } from '../../src/sections/topics'
import { webhooks } from '../../src/sections/webhooks'
import { ctxOf, fakeGitHub, fixture, OWNER, repo, writes } from './helpers'

describe('labels section', () => {
  async function world() {
    const gh = fakeGitHub()
    const list = await fixture('labels/list')
    gh.on('GET /repos/{owner}/{repo}/labels', () => list)
    for (const r of ['POST /repos/{owner}/{repo}/labels', 'PATCH /repos/{owner}/{repo}/labels/{name}', 'DELETE /repos/{owner}/{repo}/labels/{name}']) gh.on(r, () => ({}))
    return gh
  }

  test('diff by name (case-insensitive): noop, update, create; prune deletes destructively', async () => {
    const gh = await world()
    const desired = {
      prune: true,
      labels: [
        { name: 'bug', color: '#D73A4A', description: "Something isn't working" },
        { name: 'documentation', color: '0075ca' },
        { name: 'enhancement', color: 'a2eeef', description: 'New feature' },
      ],
    }
    const changes = labels.diff(desired, await labels.read(ctxOf(gh)), repo)
    expect(changes.map((c) => [c.op, c.target, c.destructive])).toEqual([
      ['noop', 'bug', false],
      ['update', 'Documentation', false],
      ['create', 'enhancement', false],
      ['delete', 'wontfix', true],
    ])
    // description left out keeps the current one
    expect(changes[1]!.after).toEqual({ name: 'documentation', color: '0075ca', description: 'Improvements or additions to documentation' })
    expect(labels.diff({ labels: desired.labels }, await labels.read(ctxOf(gh)), repo).some((c) => c.op === 'delete')).toBe(false)
  })

  test('apply sends POST / PATCH new_name / DELETE', async () => {
    const gh = await world()
    const desired = { prune: true, labels: [{ name: 'documentation', color: '0075ca' }, { name: 'enhancement', color: 'a2eeef' }, { name: 'bug', color: 'd73a4a' }] }
    const changes = labels.diff(desired, await labels.read(ctxOf(gh)), repo).filter((c) => c.op !== 'noop')
    const results = await labels.apply(ctxOf(gh, repo, false), changes)
    expect(results.every((r) => r.outcome === 'applied')).toBe(true)
    expect(writes(gh)).toEqual([
      { route: 'PATCH /repos/{owner}/{repo}/labels/{name}', params: { ...OWNER, name: 'Documentation', new_name: 'documentation', color: '0075ca', description: 'Improvements or additions to documentation' } },
      { route: 'POST /repos/{owner}/{repo}/labels', params: { ...OWNER, name: 'enhancement', color: 'a2eeef', description: '' } },
      { route: 'DELETE /repos/{owner}/{repo}/labels/{name}', params: { ...OWNER, name: 'wontfix' } },
    ])
  })

  test('one failing label does not stop the others', async () => {
    const gh = await world()
    gh.on('POST /repos/{owner}/{repo}/labels', () => {
      throw fakeError(422, 'Validation Failed')
    })
    const changes = labels.diff({ labels: [{ name: 'a', color: '000000' }, { name: 'bug', color: '000000' }] }, await labels.read(ctxOf(gh)), repo)
    const results = await labels.apply(ctxOf(gh, repo, false), changes.filter((c) => c.op !== 'noop'))
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'applied'])
  })

  test('schema rejects bad colours', () => {
    expect(labels.schema.safeParse({ labels: [{ name: 'x', color: 'red' }] }).success).toBe(false)
  })
})

describe('topics section', () => {
  async function world() {
    const gh = fakeGitHub()
    const t = await fixture('topics/topics')
    gh.on('GET /repos/{owner}/{repo}/topics', () => t)
    gh.on('PUT /repos/{owner}/{repo}/topics', (p) => ({ names: p.names }))
    return gh
  }

  test('replace / add / noop', async () => {
    const gh = await world()
    const cur = await topics.read(ctxOf(gh))
    expect(topics.diff({ topics: ['typescript', 'github'] }, cur, repo)[0]!.op).toBe('noop')
    expect(topics.diff({ topics: ['bun'] }, cur, repo)[0]).toMatchObject({ op: 'update', before: ['github', 'typescript'], after: ['bun'], destructive: false })
    expect(topics.diff({ topics: ['bun'], mode: 'add' }, cur, repo)[0]!.after).toEqual(['bun', 'github', 'typescript'])
  })

  test('apply PUTs the full list', async () => {
    const gh = await world()
    const [c] = topics.diff({ topics: ['bun'], mode: 'add' }, await topics.read(ctxOf(gh)), repo)
    await topics.apply(ctxOf(gh, repo, false), [c!])
    expect(writes(gh)).toEqual([{ route: 'PUT /repos/{owner}/{repo}/topics', params: { ...OWNER, names: ['bun', 'github', 'typescript'] } }])
  })

  test('schema: lowercase topics, max 20', () => {
    expect(topics.schema.safeParse({ topics: ['Bad'] }).success).toBe(false)
    expect(topics.schema.safeParse({ topics: Array.from({ length: 21 }, (_, i) => `t${i}`) }).success).toBe(false)
  })
})

describe('webhooks section', () => {
  afterEach(() => {
    delete Bun.env.WEBHOOK_SECRET_CI
  })

  async function world() {
    const gh = fakeGitHub()
    const list = await fixture('webhooks/list')
    gh.on('GET /repos/{owner}/{repo}/hooks', () => list)
    for (const r of ['POST /repos/{owner}/{repo}/hooks', 'PATCH /repos/{owner}/{repo}/hooks/{hook_id}', 'DELETE /repos/{owner}/{repo}/hooks/{hook_id}']) gh.on(r, () => ({ id: 1 }))
    return gh
  }

  const ci = { url: 'https://hooks.example.com/ci', events: ['pull_request', 'push'], secret_ref: 'WEBHOOK_SECRET_CI' }

  test('diff by URL: noop on the recorded hook, update, create; prune deletes destructively', async () => {
    const gh = await world()
    const cur = await webhooks.read(ctxOf(gh))
    expect(webhooks.diff({ hooks: [ci] }, cur, repo).map((c) => c.op)).toEqual(['noop'])
    const changes = webhooks.diff({ prune: true, hooks: [{ ...ci, events: ['push'] }, { url: 'https://new.example.com/x' }] }, cur, repo)
    expect(changes.map((c) => [c.op, c.target, c.destructive])).toEqual([
      ['update', 'https://hooks.example.com/ci', false],
      ['create', 'https://new.example.com/x', false],
      ['delete', 'https://old.example.com/hook', true],
    ])
    // the secret is referenced by name only, never resolved into the plan
    expect(JSON.stringify(changes)).not.toContain('s3cret')
  })

  test('apply resolves secret_ref at apply time and sends the exact bodies', async () => {
    Bun.env.WEBHOOK_SECRET_CI = 's3cret'
    const gh = await world()
    const changes = webhooks
      .diff({ prune: true, hooks: [{ ...ci, events: ['push'] }, { url: 'https://new.example.com/x' }] }, await webhooks.read(ctxOf(gh)), repo)
      .filter((c) => c.op !== 'noop')
    const results = await webhooks.apply(ctxOf(gh, repo, false), changes)
    expect(results.map((r) => r.outcome)).toEqual(['applied', 'applied', 'applied'])
    expect(writes(gh)).toEqual([
      {
        route: 'PATCH /repos/{owner}/{repo}/hooks/{hook_id}',
        params: { ...OWNER, hook_id: 500000001, active: true, events: ['push'], config: { url: ci.url, content_type: 'json', insecure_ssl: '0', secret: 's3cret' } },
      },
      {
        route: 'POST /repos/{owner}/{repo}/hooks',
        params: { ...OWNER, name: 'web', active: true, events: ['push'], config: { url: 'https://new.example.com/x', content_type: 'json', insecure_ssl: '0' } },
      },
      { route: 'DELETE /repos/{owner}/{repo}/hooks/{hook_id}', params: { ...OWNER, hook_id: 500000002 } },
    ])
  })

  test('an unset secret_ref fails that change with the reason', async () => {
    const gh = await world()
    const [c] = webhooks.diff({ hooks: [{ url: 'https://new.example.com/x', secret_ref: 'WEBHOOK_SECRET_CI' }] }, await webhooks.read(ctxOf(gh)), repo)
    const [r] = await webhooks.apply(ctxOf(gh, repo, false), [c!])
    expect(r).toMatchObject({ outcome: 'failed', message: 'secret_ref WEBHOOK_SECRET_CI is not set' })
  })

  test('schema: https only, insecure_ssl only false, secret_ref limited to webhook secret names', () => {
    expect(webhooks.schema.safeParse({ hooks: [{ url: 'http://x.example.com' }] }).success).toBe(false)
    expect(webhooks.schema.safeParse({ hooks: [{ url: 'https://x.example.com', insecure_ssl: true }] }).success).toBe(false)
    expect(webhooks.schema.safeParse({ hooks: [{ url: 'https://x.example.com', secret_ref: 'API_TOKEN' }] }).success).toBe(false)
    expect(webhooks.schema.safeParse({ hooks: [{ url: 'https://x.example.com', secret_ref: 'github_webhook_secret' }] }).success).toBe(true)
  })
})
