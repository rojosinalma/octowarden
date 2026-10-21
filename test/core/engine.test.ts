import { beforeEach, describe, expect, test } from 'bun:test'
import { fresh, REPO, serveRepo, type World } from './helpers'
import { apply, audit, plan, resolveSet, sync } from '../../src/engine'
import { checkConfirm } from '../../src/engine/apply'
import { fakeError } from '../../src/github/fake'
import { listEvents, purgeEvents, recordEvent } from '../../src/lib/events'
import { AppError, ValidationError } from '../../src/lib/json'
import { getCachedRepo } from '../../src/lib/repos'
import { getRun, listRuns } from '../../src/lib/runs'
import { setSetting } from '../../src/lib/settings'
import { SECTIONS } from '../../src/sections'
import type { Section } from '../../src/sections/types'
import { memoryLibrary } from '../../src/templates/library'
import { parseYaml } from '../../src/templates/schema'
import { assignSet, saveSet, saveTemplate } from '../../src/templates/store'
import { z } from 'zod'

const ORIGIN = { source: 'api' as const, actor: 'test' }

let w: World
beforeEach(async () => {
  w = await fresh()
  const docs = parseYaml(`apiVersion: octowarden/v1
kind: Template
metadata: {name: base}
spec:
  sections:
    settings: {allow_merge_commit: false, delete_branch_on_merge: true, description: "\${{ values.description }}"}
---
apiVersion: octowarden/v1
kind: Template
metadata: {name: wiki}
spec:
  sections:
    settings: {has_wiki: true, delete_branch_on_merge: false}
---
apiVersion: octowarden/v1
kind: Template
metadata: {name: private-only}
spec:
  requires: {visibility: private}
  sections:
    settings: {has_projects: true}
---
apiVersion: octowarden/v1
kind: Set
metadata: {name: std}
spec:
  templates: [base, wiki, private-only]
  values: {description: From the set}
`)
  for (const d of docs) {
    if (d.kind === 'Template') await saveTemplate(d)
    if (d.kind === 'Set') await saveSet(d)
  }
})

describe('engine', () => {
  test('resolveSet keeps template order', async () => {
    const { set, templates } = await resolveSet('std')
    expect(set.templates).toEqual(['base', 'wiki', 'private-only'])
    expect(templates.map((t) => t.name)).toEqual(['base', 'wiki', 'private-only'])
    await expect(resolveSet('missing')).rejects.toThrow(/set "missing" not found/)
  })

  test('plan merges in order, substitutes values, skips by visibility, records run and event', async () => {
    const p = await plan({ repo: REPO, sets: ['std'], values: { description: 'Override' }, ...ORIGIN })
    expect(p.desired).toEqual({ settings: { allow_merge_commit: false, delete_branch_on_merge: false, description: 'Override', has_wiki: true } })
    expect(p.changes.map((c) => c.target).sort()).toEqual(['allow_merge_commit', 'description', 'has_wiki'])
    expect(p.skipped).toEqual([{ section: 'settings', template: 'private-only', reason: 'template "private-only" requires a private repo' }])
    expect(p.sections).toEqual([{ section: 'settings', changes: 3, noop: 1 }])
    expect(p.id).toBeString()
    expect((await getRun(p.id!))?.status).toBe('ok')
    const [ev] = await listEvents({ run_id: p.id! })
    expect(ev?.outcome).toBe('planned')
    expect(w.github.calls.some((c) => c.route.startsWith('PATCH'))).toBe(false)
  })

  test('assigned sets with per-repo values are the default target', async () => {
    await expect(plan({ repo: REPO, ...ORIGIN })).rejects.toThrow(ValidationError)
    await assignSet(REPO, 'std', { description: 'Per repo' })
    const p = await plan({ repo: REPO, ...ORIGIN })
    expect((p.desired.settings as Record<string, unknown>).description).toBe('Per repo')
  })

  test('missing values fail with every key named', async () => {
    const lib = memoryLibrary(parseYaml('apiVersion: octowarden/v1\nkind: Template\nmetadata: {name: t}\nspec: {sections: {settings: {description: "${{ values.d }}", homepage: "${{ values.h }}"}}}'))
    await expect(plan({ repo: REPO, templates: ['t'], library: lib, ...ORIGIN, record: false })).rejects.toThrow('missing values: d, h')
  })

  test('apply writes, records one event per change and audit then reports clean', async () => {
    const p = await plan({ repo: REPO, sets: ['std'], ...ORIGIN })
    const report = await apply(p, ORIGIN)
    expect(report.status).toBe('ok')
    expect(report.applied).toBe(3)
    const events = await listEvents({ run_id: report.run_id! })
    expect(events.filter((e) => e.outcome === 'applied')).toHaveLength(3)
    expect(events.filter((e) => e.outcome === 'skipped')).toHaveLength(1)
    const drift = await audit(REPO, { ...ORIGIN, sets: ['std'] })
    expect(drift.state).toBe('clean')
    expect((await getCachedRepo(REPO))?.drift_state).toBe('clean')
  })

  test('audit finds drift and stores it; GitHub failure is state error, not a throw', async () => {
    const drift = await audit(REPO, { ...ORIGIN, sets: ['std'] })
    expect(drift.state).toBe('drift')
    expect(drift.changes).toHaveLength(3)
    expect((await getCachedRepo(REPO))?.drift_state).toBe('drift')
    w.github.on('GET /repos/{owner}/{repo}', () => {
      throw fakeError(502, 'Bad gateway')
    })
    const err = await audit(REPO, { ...ORIGIN, sets: ['std'] })
    expect(err.state).toBe('error')
    expect(err.message).toBe('Bad gateway')
  })

  test('sync = plan + apply in one run', async () => {
    const { report } = await sync({ repo: REPO, sets: ['std'], ...ORIGIN })
    expect(report.applied).toBe(3)
    expect((await listRuns({ kind: 'sync' }))[0]?.status).toBe('ok')
  })

  test('destructive changes need confirm = repo full name', async () => {
    const p = await plan({ repo: REPO, sets: ['std'], ...ORIGIN })
    p.changes[0]!.destructive = true
    p.destructive = 1
    expect(() => checkConfirm(p, undefined)).toThrow(AppError)
    expect(() => checkConfirm(p, 'octo-example/other')).toThrow(/confirm with the repo name/)
    await expect(apply(p, ORIGIN)).rejects.toThrow(/destructive/)
    expect((await apply(p, { ...ORIGIN, confirm: REPO })).status).toBe('ok')
  })

  test('a plan-limit 403 on read skips the section; a failing apply is recorded, the run continues', async () => {
    const limited: Section<{ on: boolean }, boolean> = {
      name: 'limited',
      title: 'Limited',
      description: 'test only',
      schema: z.strictObject({ on: z.boolean() }),
      async read() {
        throw fakeError(403, 'Upgrade to GitHub Pro or make this repository public to enable this feature.')
      },
      diff: () => [],
      apply: async () => [],
    }
    SECTIONS.limited = limited
    try {
      const lib = memoryLibrary(
        parseYaml('apiVersion: octowarden/v1\nkind: Template\nmetadata: {name: t}\nspec: {sections: {settings: {has_wiki: true}, limited: {on: true}}}'),
      )
      const p = await plan({ repo: REPO, templates: ['t'], library: lib, ...ORIGIN })
      expect(p.skipped).toEqual([{ section: 'limited', reason: 'Upgrade to GitHub Pro or make this repository public to enable this feature.' }])
      expect(p.changes.map((c) => c.target)).toEqual(['has_wiki'])

      w.github.on('PATCH /repos/{owner}/{repo}', () => {
        throw fakeError(422, 'Validation Failed')
      })
      const report = await apply(p, ORIGIN)
      expect(report.status).toBe('failed')
      expect(report.results[0]).toMatchObject({ outcome: 'failed', message: 'Validation Failed' })
    } finally {
      delete SECTIONS.limited
      serveRepo(w.github)
    }
  })
})

describe('events', () => {
  test('diffs are redacted before storage', async () => {
    await recordEvent({ ...ORIGIN, action: 'x', outcome: 'info', diff: { after: { secret: 's', github_token: 't', name: 'n' } } })
    const [ev] = await listEvents()
    expect(ev?.diff).toEqual({ after: { secret: '***', github_token: '***', name: 'n' } })
  })

  test('purge removes events older than audit_retention_days', async () => {
    await recordEvent({ ...ORIGIN, action: 'old', outcome: 'info' })
    await setSetting('audit_retention_days', '1')
    expect((await purgeEvents(Date.now() + 2 * 86_400_000)).events).toBe(1)
    expect(await listEvents()).toHaveLength(0)
  })
})
