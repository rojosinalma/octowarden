import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { z } from 'zod'
import { call, fresh, REPO, until, type World } from './helpers'
import { setConfig, loadConfig } from '../../src/lib/config'
import { SECTIONS } from '../../src/sections'
import type { Section } from '../../src/sections/types'
import { TEST_ENV } from '../core/helpers'

const TEMPLATE = {
  apiVersion: 'octowarden/v1',
  kind: 'Template',
  metadata: { name: 'squash', description: 'squash only' },
  spec: { sections: { settings: { allow_merge_commit: false, delete_branch_on_merge: true } } },
}
const SET = { apiVersion: 'octowarden/v1', kind: 'Set', metadata: { name: 'std' }, spec: { templates: ['squash'] } }

// A section whose only change is destructive, to exercise confirm.
const doomed: Section<{ drop: boolean }, { present: boolean }> = {
  name: 'doomed',
  title: 'Doomed',
  description: 'test only',
  schema: z.strictObject({ drop: z.boolean() }),
  read: async () => ({ present: true }),
  diff: (d, c) => [{ section: 'doomed', op: d.drop && c.present ? 'delete' : 'noop', target: 'thing', before: c.present, after: false, destructive: true }],
  apply: async (_ctx, changes) => changes.map((change) => ({ change, outcome: 'applied', message: 'dropped' })),
}

let w: World
beforeAll(() => void (SECTIONS.doomed = doomed))
afterAll(() => void delete SECTIONS.doomed)
beforeEach(async () => {
  w = await fresh()
})

describe('auth', () => {
  test('503 while API_TOKEN is unset', async () => {
    setConfig(loadConfig({ ...TEST_ENV, API_TOKEN: '' }))
    const r = await call('GET', '/api/templates')
    expect(r.status).toBe(503)
    expect(r.body.message).toBe('API_TOKEN not configured')
  })
  test('401 without or with a wrong bearer', async () => {
    expect((await call('GET', '/api/templates', undefined, { token: null })).status).toBe(401)
    expect((await call('GET', '/api/templates', undefined, { token: 'nope' })).status).toBe(401)
    expect((await call('GET', '/api/stream', undefined, { token: 'nope' })).status).toBe(401)
  })
  test('200 with the token', async () => {
    const r = await call('GET', '/api/sections')
    expect(r.status).toBe(200)
    expect(r.body.ok).toBe(true)
    const settings = r.body.sections.find((s: { name: string }) => s.name === 'settings')
    expect(settings.jsonSchema.type).toBe('object')
  })
})

describe('templates and sets', () => {
  test('built-ins are listed and read-only', async () => {
    const r = await call('GET', '/api/templates')
    expect(r.body.templates.find((t: { name: string }) => t.name === 'base')).toMatchObject({ builtin: true })
    expect((await call('GET', '/api/sets')).body.sets.find((s: { name: string }) => s.name === 'house')).toMatchObject({ builtin: true })
    expect((await call('PUT', '/api/templates/base', { ...TEMPLATE, metadata: { name: 'base' } })).status).toBe(409)
    expect((await call('DELETE', '/api/templates/base', { confirm: 'base' })).status).toBe(409)
    expect((await call('GET', '/api/templates/base')).body.template.used_by).toContain('house')
  })

  test('CRUD with typed confirm', async () => {
    let r = await call('PUT', '/api/templates/squash', TEMPLATE)
    expect(r.status).toBe(201)
    expect(r.body.template).toMatchObject({ name: 'squash', builtin: false })
    r = await call('PUT', '/api/templates/squash', TEMPLATE)
    expect(r.status).toBe(200)
    expect(r.body.message).toBe('template squash updated')
    expect((await call('PUT', '/api/templates/other', TEMPLATE)).status).toBe(422)
    expect((await call('PUT', '/api/templates/bad', { ...TEMPLATE, metadata: { name: 'bad' }, spec: { sections: { nope: {} } } })).status).toBe(422)

    r = await call('GET', '/api/templates')
    expect(r.body.templates.map((t: { name: string }) => t.name)).toContain('squash')

    r = await call('PUT', '/api/sets/std', SET)
    expect(r.status).toBe(201)
    expect((await call('PUT', '/api/sets/x', { ...SET, metadata: { name: 'x' }, spec: { templates: ['missing'] } })).status).toBe(422)

    r = await call('GET', '/api/templates/squash')
    expect(r.body.template.used_by).toEqual(['std'])
    expect(r.body.template.doc.kind).toBe('Template')

    // In use by a set → 409; wrong confirm → 409 confirm_required.
    r = await call('DELETE', '/api/templates/squash', { confirm: 'squash' })
    expect(r.status).toBe(409)
    r = await call('DELETE', '/api/sets/std', { confirm: 'wrong' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('confirm_required')
    expect((await call('DELETE', '/api/sets/std', { confirm: 'std' })).status).toBe(200)
    expect((await call('DELETE', '/api/templates/squash', { confirm: 'squash' })).status).toBe(200)
    expect((await call('GET', '/api/templates/squash')).status).toBe(404)
  })
})

describe('repos', () => {
  test('assign sets, get, list', async () => {
    await call('PUT', '/api/templates/squash', TEMPLATE)
    await call('PUT', '/api/sets/std', SET)
    let r = await call('PUT', `/api/repos/${REPO}/sets`, { sets: [{ set: 'std', values: { x: 1 } }] })
    expect(r.status).toBe(200)
    expect(r.body.repo.sets).toEqual([{ set: 'std', values: { x: 1 } }])
    expect((await call('PUT', `/api/repos/${REPO}/sets`, { sets: [{ set: 'nope' }] })).status).toBe(404)

    r = await call('GET', `/api/repos/${REPO}`)
    expect(r.body.repo).toMatchObject({ full_name: REPO, owner: 'octo-example', default_branch: 'main', visibility: 'public' })
    expect(r.body.repo.events[0].action).toBe('repo.assign_sets')

    r = await call('GET', '/api/repos')
    expect(r.body.repos.map((x: { full_name: string }) => x.full_name)).toEqual([REPO])
  })

  test('refresh from GitHub, create and delete with confirm', async () => {
    const fixture = (await w.github.request('GET /repos/{owner}/{repo}', {})).data
    w.github.on('GET /user/repos', () => [fixture, { ...fixture, name: 'two', full_name: 'octo-example/two' }])
    let r = await call('GET', '/api/repos?refresh=1')
    expect(r.body.repos.map((x: { full_name: string }) => x.full_name)).toEqual([REPO, 'octo-example/two'])

    w.github.on('POST /user/repos', (p) => ({ ...fixture, name: p.name, full_name: `octo-example/${p.name}`, private: p.private, visibility: 'private' }))
    r = await call('POST', '/api/repos', { name: 'fresh', private: true })
    expect(r.status).toBe(201)
    expect(r.body.repo).toMatchObject({ full_name: 'octo-example/fresh', private: true })

    w.github.on('DELETE /repos/{owner}/{repo}', () => undefined)
    r = await call('DELETE', '/api/repos/octo-example/fresh', { confirm: 'fresh' })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('confirm_required')
    expect(w.github.calls.some((c) => c.route.startsWith('DELETE'))).toBe(false)
    r = await call('DELETE', '/api/repos/octo-example/fresh', { confirm: 'octo-example/fresh' })
    expect(r.status).toBe(200)
    const ev = await call('GET', '/api/events?repo=octo-example/fresh&outcome=applied')
    expect(ev.body.events.map((e: { action: string }) => e.action)).toEqual(['repo.delete', 'repo.create'])
  })

  test('lookups', async () => {
    w.github.on('GET /repos/{owner}/{repo}/branches', () => [{ name: 'main' }, { name: 'dev' }])
    w.github.on('GET /repos/{owner}/{repo}/commits/{ref}/check-runs', () => ({ check_runs: [{ name: 'check' }, { name: 'check' }] }))
    w.github.on('GET /repos/{owner}/{repo}/commits/{ref}/status', () => ({ statuses: [{ context: 'ci/legacy' }] }))
    w.github.on('GET /repos/{owner}/{repo}/environments', () => ({ environments: [{ name: 'prod' }] }))
    const r = await call('GET', `/api/repos/${REPO}/lookups`)
    expect(r.body).toMatchObject({ ok: true, branches: ['dev', 'main'], checks: ['check', 'ci/legacy'], teams: [], environments: ['prod'] })
  })
})

describe('plan and apply', () => {
  test('plan by template, apply by plan id', async () => {
    await call('PUT', '/api/templates/squash', TEMPLATE)
    const p = await call('POST', '/api/plan', { repo: REPO, templates: ['squash'] })
    expect(p.status).toBe(200)
    expect(p.body.plan.changes.map((c: { target: string }) => c.target).sort()).toEqual(['allow_merge_commit', 'delete_branch_on_merge'])
    const a = await call('POST', '/api/apply', { plan_id: p.body.plan.id })
    expect(a.status).toBe(200)
    expect(a.body.report).toMatchObject({ status: 'ok', applied: 2 })
    expect((await call('POST', '/api/apply', { plan_id: p.body.plan.id })).status).toBe(404)
  })

  test('destructive change: 409 confirm_required, then apply with confirm', async () => {
    const doc = { apiVersion: 'octowarden/v1', kind: 'Template', metadata: { name: 'd' }, spec: { sections: { doomed: { drop: true } } } }
    let r = await call('POST', '/api/apply', { repo: REPO, doc })
    expect(r.status).toBe(409)
    expect(r.body.code).toBe('confirm_required')
    r = await call('POST', '/api/apply', { repo: REPO, doc, confirm: REPO })
    expect(r.status).toBe(200)
    expect(r.body.report.applied).toBe(1)
  })

  test('bulk apply skips destructive changes; progress on the run', async () => {
    await call('PUT', '/api/templates/squash', TEMPLATE)
    await call('PUT', '/api/templates/d', { apiVersion: 'octowarden/v1', kind: 'Template', metadata: { name: 'd' }, spec: { sections: { doomed: { drop: true } } } })
    const r = await call('POST', '/api/bulk', { repos: [REPO], templates: ['squash', 'd'], mode: 'apply' })
    expect(r.status).toBe(202)
    const run = await until(async () => {
      const x = await call('GET', `/api/runs/${r.body.run_id}`)
      return x.body.run.finished_at ? x.body.run : undefined
    })
    expect(run.summary.totals).toMatchObject({ repos: 1, done: 1, failed: 0, applied: 2 })
    const events = await call('GET', '/api/events?section=doomed&outcome=skipped')
    expect(events.body.events[0].message).toStartWith('destructive: apply on the single repo with confirm')
  })

  test('audit of assigned repos', async () => {
    await call('PUT', '/api/templates/squash', TEMPLATE)
    await call('PUT', '/api/sets/std', SET)
    await call('PUT', `/api/repos/${REPO}/sets`, { sets: [{ set: 'std' }] })
    const r = await call('POST', '/api/audit', {})
    const run = await until(async () => {
      const x = await call('GET', `/api/runs/${r.body.run_id}`)
      return x.body.run.finished_at ? x.body.run : undefined
    })
    expect(run.status).toBe('drift')
    expect((await call('GET', `/api/repos/${REPO}`)).body.repo.drift_state).toBe('drift')
    expect((await call('GET', '/api/runs?limit=5')).body.runs.length).toBeGreaterThan(0)
  })
})

describe('export, import, events, settings', () => {
  test('export/import round trip', async () => {
    const tpl = { ...TEMPLATE, spec: { sections: { settings: { allow_merge_commit: false } } } }
    await call('PUT', '/api/templates/squash', tpl)
    await call('PUT', '/api/sets/std', { ...SET, spec: { templates: ['squash'], values: { api_token: 'sekrit', team: 'core' } } })
    await call('PUT', `/api/repos/${REPO}/sets`, { sets: [{ set: 'std' }] })
    const ex = await call('GET', '/api/export?manifest=1&templates=squash&sets=std')
    expect(ex.status).toBe(200)
    expect(ex.headers.get('content-type')).toContain('text/yaml')
    expect(ex.text).toContain('kind: Manifest')
    expect(ex.text).not.toContain('sekrit')

    await fresh()
    let r = await call('POST', '/api/import', ex.text, { headers: { 'content-type': 'text/yaml' } })
    expect(r.status).toBe(200)
    expect(r.body.counts).toEqual({ templates: 1, sets: 1, repos: 1 })
    expect((await call('GET', '/api/sets/std')).body.set.values).toEqual({ team: 'core' })
    r = await call('POST', '/api/import', { yaml: 'kind: Nope' })
    expect(r.status).toBe(422)
  })

  test('events filter by source and actor', async () => {
    await call('PUT', '/api/templates/squash', TEMPLATE)
    const r = await call('GET', '/api/events?source=api&actor=api')
    expect(r.body.events[0]).toMatchObject({ action: 'template.create', source: 'api', actor: 'api' })
    expect((await call('GET', '/api/events?source=ui')).body.events).toEqual([])
    expect((await call('GET', '/api/events?source=bogus')).status).toBe(422)
  })

  test('settings: secrets masked, validation', async () => {
    let r = await call('PUT', '/api/settings', { github_token: 'ghp_x', audit_interval_min: '60' })
    expect(r.status).toBe(200)
    expect(r.body.settings).toMatchObject({ github_token: 'set', audit_interval_min: '60', ui_actor_header: 'remote-user' })
    expect(JSON.stringify(r.body)).not.toContain('ghp_x')
    expect((await call('PUT', '/api/settings', { nope: '1' })).status).toBe(422)
    expect((await call('PUT', '/api/settings', { audit_interval_min: 'soon' })).status).toBe(422)
    r = await call('GET', '/api/settings')
    expect(r.body.settings.github_token).toBe('set')
  })
})

describe('stream', () => {
  test('/api/stream and /ui/stream deliver bus events', async () => {
    const { createApp } = await import('../../src/app')
    const { bus } = await import('../../src/lib/bus')
    const app = createApp()
    for (const [path, headers] of [
      ['/api/stream?topics=drift', { authorization: 'Bearer test-api-token' }],
      ['/ui/stream?topics=drift', {}],
    ] as const) {
      const ctrl = new AbortController()
      const res = await app.handle(new Request(`http://localhost${path}`, { headers, signal: ctrl.signal }))
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('text/event-stream')
      const reader = res.body!.getReader()
      const dec = new TextDecoder()
      expect(dec.decode((await reader.read()).value)).toBe(': connected\n\n')
      bus.publish('drift', { repo: REPO, state: 'drift' })
      expect(dec.decode((await reader.read()).value)).toBe(`event: drift\ndata: {"repo":"${REPO}","state":"drift"}\n\n`)
      await reader.cancel()
      ctrl.abort()
    }
    const { sseClients } = await import('../../src/lib/sse')
    expect(sseClients()).toBe(0)
  })
})
