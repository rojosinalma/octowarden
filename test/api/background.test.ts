import { beforeEach, describe, expect, test } from 'bun:test'
import { call, fresh, REPO, type World } from './helpers'
import { setGitHubClient } from '../../src/auth/providers'
import { recordEvent } from '../../src/lib/events'
import { metrics, watchRuns } from '../../src/lib/metrics'
import { createPlanCache } from '../../src/lib/plans'
import { schedulerStatus, tick } from '../../src/lib/scheduler'
import { setSetting } from '../../src/lib/settings'
import { listRuns } from '../../src/lib/runs'
import type { Plan } from '../../src/engine/types'

const TEMPLATE = { apiVersion: 'octowarden/v1', kind: 'Template', metadata: { name: 'wiki' }, spec: { sections: { settings: { has_wiki: true } } } }
const SET = { apiVersion: 'octowarden/v1', kind: 'Set', metadata: { name: 'std' }, spec: { templates: ['wiki'] } }

let w: World
beforeEach(async () => {
  w = await fresh()
})

describe('scheduler', () => {
  test('tick audits assigned repos and purges old events', async () => {
    await call('PUT', '/api/templates/wiki', TEMPLATE)
    await call('PUT', '/api/sets/std', SET)
    await call('PUT', `/api/repos/${REPO}/sets`, { sets: [{ set: 'std' }] })
    await recordEvent({ actor: 'x', source: 'api', action: 'old', outcome: 'info' })
    await w.db.kysely.updateTable('events').set({ at: '2000-01-01T00:00:00.000Z' }).where('action', '=', 'old').execute()
    await tick()
    const s = schedulerStatus()
    expect(s.last_audit_run).toBeTruthy()
    const runs = await listRuns({ kind: 'audit' })
    expect(runs.find((r) => r.id === s.last_audit_run)).toMatchObject({ source: 'scheduler', actor: 'scheduler', status: 'drift' })
    expect((await call('GET', '/api/events?actor=x')).body.events).toEqual([])
  })

  test('tick skips without GitHub credentials', async () => {
    setGitHubClient(undefined)
    await setSetting('github_auth_mode', 'pat')
    await tick()
    expect(schedulerStatus().last_skip).toBe('no GitHub credentials')
  })
})

describe('metrics', () => {
  test('applies, runs, repos and the rate limit', async () => {
    // fresh() clears the bus; the app subscribes once at build time.
    metrics.applies.reset()
    metrics.runs.reset()
    watchRuns()
    await call('PUT', '/api/templates/wiki', TEMPLATE)
    await call('POST', '/api/apply', { repo: REPO, templates: ['wiki'] })
    const r = await call('GET', '/metrics', undefined, { token: null })
    expect(r.status).toBe(200)
    expect(r.text).toContain('octowarden_applies_total{outcome="ok"} 1')
    expect(r.text).toContain('octowarden_runs_total{kind="apply",status="ok"} 1')
    expect(r.text).toContain('octowarden_repos{drift_state="unknown"} 1')
    expect(r.text).toContain('octowarden_last_audit_timestamp_seconds 0')
    expect(r.text).toContain('octowarden_process_cpu_seconds_total')
  })
})

describe('plan cache', () => {
  test('LRU cap and TTL', () => {
    const c = createPlanCache(2, 1000)
    const p = {} as Plan
    c.put('a', p, 0)
    c.put('b', p, 0)
    c.get('a', 1)
    c.put('c', p, 2)
    expect(c.get('b', 3)).toBeUndefined()
    expect(c.get('a', 3)).toBe(p)
    expect(c.get('c', 2000)).toBeUndefined()
  })
})
