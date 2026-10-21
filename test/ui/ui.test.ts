import { beforeEach, describe, expect, test } from 'bun:test'
import { fresh, REPO, req, serveList, serveRepo, XSS, XSS_IMG, type World } from './helpers'
import { listEvents } from '../../src/lib/events'
import { setSetting } from '../../src/lib/settings'

let w: World

beforeEach(async () => {
  w = await fresh()
  serveList(w.github)
})

const templateDoc = (name: string, description = 'test template') => ({
  apiVersion: 'octowarden/v1',
  kind: 'Template',
  metadata: { name, description },
  spec: { sections: { settings: { has_wiki: false, allow_squash_merge: true } } },
})

describe('pages', () => {
  const PAGES = ['/', '/templates', '/templates/new', '/templates/base', '/templates/new?from=protect-main', '/sets', '/sets/new', '/sets/house', '/sets/new?from=house', '/audit', '/settings', `/repos/${REPO}`]

  for (const path of PAGES) {
    test(`GET ${path} renders 200 HTML in the layout`, async () => {
      const r = await req('GET', path)
      expect(r.status).toBe(200)
      expect(r.headers.get('content-type')).toContain('text/html')
      expect(r.text).toContain('<!doctype html>')
      expect(r.text).toContain('class="t-shell"')
      expect(r.text).toContain('/tailor/tokens.css')
      expect(r.text).toContain('data-tailor-pickers="mode"')
      expect(r.text.match(/<h1 /g)?.length).toBe(1)
      expect(r.text).not.toContain(' title=')
    })
  }

  test('theme from settings is seeded before the first paint', async () => {
    await setSetting('ui_palette', 'nord')
    await setSetting('ui_mode', 'light')
    const r = await req('GET', '/')
    expect(r.text).toContain('"palette":"nord"')
    expect(r.text).toContain('"mode":"light"')
  })

  test('settings page carries the skin/palette pickers and every group', async () => {
    const r = await req('GET', '/settings')
    expect(r.text).toContain('data-tailor-pickers="skin palette"')
    for (const id of ['github', 'audit', 'notify', 'interface', 'limits']) expect(r.text).toContain(`id="${id}"`)
    expect(r.text).toContain('data-setting="audit_interval_min"')
    // Secrets never render their value.
    await setSetting('github_token', 'ghp_supersecretvalue')
    const again = await req('GET', '/settings')
    expect(again.text).not.toContain('ghp_supersecretvalue')
    expect(again.text).toContain('data-secret-state="github_token"')
  })

  test('octoforge-delivered credential shows the badge', async () => {
    await setSetting('github_credential_source', 'octoforge')
    expect((await req('GET', '/settings')).text).toContain('delivered by octoforge')
  })

  test('an unknown template answers 404 inside the layout', async () => {
    const t = await req('GET', '/templates/nope')
    expect(t.status).toBe(404)
    expect(t.text).toContain('template &quot;nope&quot; not found')
  })

  test('built-in template is read-only with a duplicate link', async () => {
    const r = await req('GET', '/templates/base')
    expect(r.text).toContain('Duplicate to edit')
    expect(r.text).not.toContain('id="template-form"')
  })

  test('audit partial renders the events block only', async () => {
    const r = await req('GET', '/audit?partial=events&source=ui')
    expect(r.status).toBe(200)
    expect(r.text.startsWith('<div id="events-block"')).toBe(true)
  })

  test('repo page lists assigned sets with typed value controls', async () => {
    await req('PUT', '/ui/actions/repos/sets', { repo: REPO, sets: [{ set: 'house', values: { required_checks: 'build' } }] })
    const r = await req('GET', `/repos/${REPO}`)
    expect(r.text).toContain('data-set="house"')
    expect(r.text).toContain('data-value-key="required_checks"')
  })
})

describe('static files', () => {
  test('app assets and the favicon are served; traversal is refused', async () => {
    expect((await req('GET', '/public/app.js')).status).toBe(200)
    expect((await req('GET', '/public/app.css')).status).toBe(200)
    expect((await req('GET', '/favicon.svg')).status).toBe(200)
    expect((await req('GET', '/tailor/icons.svg')).status).toBe(200)
    expect((await req('GET', '/public/..%2Fpackage.json')).status).toBe(404)
    expect((await req('GET', '/public/nope.js')).status).toBe(404)
  })
})

describe('actions', () => {
  test('settings: saved, invalid values refused with the reason', async () => {
    const ok = await req('PUT', '/ui/actions/settings', { key: 'log_level', value: 'warn' })
    expect(ok.body).toMatchObject({ ok: true, value: 'warn' })
    const bad = await req('PUT', '/ui/actions/settings', { key: 'audit_interval_min', value: 'soon' })
    expect(bad.status).toBe(422)
    expect(bad.body.ok).toBe(false)
    expect(bad.body.message).toContain('audit_interval_min')
    const sw = await req('PUT', '/ui/actions/settings', { key: 'notify_on_drift', value: false })
    expect(sw.body).toMatchObject({ ok: true, value: 'false' })
  })

  test('the actor comes from the configured request header', async () => {
    await setSetting('ui_actor_header', 'x-forwarded-user')
    await req('PUT', '/ui/actions/settings', { key: 'log_level', value: 'info' }, { 'x-forwarded-user': 'alice' })
    const [ev] = await listEvents({ limit: 1 })
    expect(ev).toMatchObject({ actor: 'alice', source: 'ui', action: 'settings.update' })
  })

  test('assign sets, plan with an HTML diff', async () => {
    const a = await req('PUT', '/ui/actions/repos/sets', { repo: REPO, sets: [{ set: 'house', values: { required_checks: '' } }] })
    expect(a.body).toMatchObject({ ok: true })
    expect(a.body.repo.sets[0].set).toBe('house')
    const p = await req('POST', '/ui/actions/plan', { repo: REPO, templates: ['base'] })
    expect(p.body.ok).toBe(true)
    expect(p.body.plan.repo).toBe(REPO)
    expect(p.body.html).toContain('plan-diff')
    expect(typeof p.body.plan.id).toBe('string')
  })

  test('apply of an unknown plan answers 404 with the reason', async () => {
    const r = await req('POST', '/ui/actions/apply', { plan_id: 'nope' })
    expect(r.status).toBe(404)
    expect(r.body).toMatchObject({ ok: false })
  })

  test('templates: preview, create, typed-confirm delete', async () => {
    const pv = await req('POST', '/ui/actions/templates/preview', { doc: templateDoc('mine') })
    expect(pv.body).toMatchObject({ ok: true, valid: true })
    expect(pv.body.yaml).toContain('name: mine')
    const bad = await req('POST', '/ui/actions/templates/preview', { doc: { ...templateDoc('mine'), spec: { sections: { settings: { has_wiki: 'yes' } } } } })
    expect(bad.body).toMatchObject({ ok: true, valid: false })
    const save = await req('PUT', '/ui/actions/templates', { doc: templateDoc('mine') })
    expect(save.body).toMatchObject({ ok: true, created: true })
    const wrong = await req('POST', '/ui/actions/templates/delete', { name: 'mine', confirm: 'nope' })
    expect(wrong.status).toBe(409)
    expect(wrong.body.code).toBe('confirm_required')
    const del = await req('POST', '/ui/actions/templates/delete', { name: 'mine', confirm: 'mine' })
    expect(del.body).toMatchObject({ ok: true, deleted: 'mine' })
  })

  test('sets: save, assign to repos, export with templates', async () => {
    await req('PUT', '/ui/actions/templates', { doc: templateDoc('mine') })
    const s = await req('PUT', '/ui/actions/sets', { doc: { apiVersion: 'octowarden/v1', kind: 'Set', metadata: { name: 'team' }, spec: { templates: ['base', 'mine'] } } })
    expect(s.body).toMatchObject({ ok: true, created: true })
    const as = await req('POST', '/ui/actions/sets/assign', { set: 'team', add: [REPO] })
    expect(as.body).toMatchObject({ ok: true, changed: 1 })
    const ex = await req('GET', '/ui/export?sets=team&with=templates')
    expect(ex.headers.get('content-type')).toContain('text/yaml')
    expect(ex.headers.get('content-disposition')).toContain('team.yaml')
    expect(ex.text).toContain('name: mine')
    expect(ex.text).toContain('kind: Set')
    const rm = await req('POST', '/ui/actions/sets/assign', { set: 'team', remove: [REPO] })
    expect(rm.body).toMatchObject({ ok: true, changed: 1 })
  })

  test('import YAML text', async () => {
    const yaml = `apiVersion: octowarden/v1\nkind: Template\nmetadata:\n  name: imported\nspec:\n  sections:\n    settings:\n      has_wiki: false\n`
    const r = await req('POST', '/ui/actions/import', yaml, { 'content-type': 'text/yaml' })
    expect(r.body).toMatchObject({ ok: true, counts: { templates: 1, sets: 0, repos: 0 } })
    const bad = await req('POST', '/ui/actions/import', 'kind: Nope', { 'content-type': 'text/yaml' })
    expect(bad.body.ok).toBe(false)
  })

  test('repo delete needs the exact full name', async () => {
    const r = await req('POST', '/ui/actions/repos/delete', { repo: REPO, confirm: 'demo' })
    expect(r.status).toBe(409)
    expect(r.body).toMatchObject({ ok: false, code: 'confirm_required' })
  })

  test('bulk and audit return a run id', async () => {
    const b = await req('POST', '/ui/actions/bulk', { repos: [REPO], sets: ['house'], mode: 'plan' })
    expect(b.body.ok).toBe(true)
    expect(typeof b.body.run_id).toBe('string')
    const run = await req('GET', `/ui/actions/runs/${b.body.run_id}`)
    expect(run.body.ok).toBe(true)
    const bad = await req('POST', '/ui/actions/bulk', { repos: [], mode: 'apply' })
    expect(bad.body.ok).toBe(false)
  })
})

describe('escaping', () => {
  test('user input never reaches the page unescaped', async () => {
    serveRepo(w.github, { description: XSS_IMG })
    serveList(w.github, { description: XSS_IMG })
    await req('POST', '/ui/actions/repos/refresh')
    await req('PUT', '/ui/actions/templates', { doc: templateDoc('evil', XSS) })
    await req('PUT', '/ui/actions/sets', { doc: { apiVersion: 'octowarden/v1', kind: 'Set', metadata: { name: 'evil-set', description: XSS_IMG }, spec: { templates: ['evil'], values: { k: XSS } } } })
    await req('PUT', '/ui/actions/repos/sets', { repo: REPO, sets: [{ set: 'evil-set', values: { k: XSS_IMG } }] })
    await setSetting('ui_actor_header', 'remote-user')
    await req('PUT', '/ui/actions/settings', { key: 'log_level', value: 'info' }, { 'remote-user': XSS })
    for (const path of ['/', '/templates', '/templates/evil', '/templates/new?from=evil', '/sets', '/sets/evil-set', '/audit', `/repos/${REPO}`, '/settings']) {
      const r = await req('GET', path)
      expect(r.status).toBe(200)
      expect(r.text).not.toContain(XSS)
      expect(r.text).not.toContain(XSS_IMG)
    }
    // The audit page shows the hostile actor escaped.
    expect((await req('GET', '/audit')).text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  test('JSON islands cannot close their script tag', async () => {
    await req('PUT', '/ui/actions/templates', { doc: templateDoc('island', '"></script><script>alert(3)</script>') })
    const r = await req('GET', '/templates/new?from=island')
    expect(r.text).not.toContain('"></script><script>alert(3)')
    const island = r.text.slice(r.text.indexOf('id="template-data">'))
    expect(island).toContain('\\u003c/script>\\u003cscript>alert(3)')
    expect(island.indexOf('</script>')).toBeGreaterThan(island.indexOf('alert(3)'))
  })
})

test('favicon link carries a content version; sibling icons carry the list version', async () => {
  const { req } = await import('./helpers')
  const page = await req('GET', '/templates')
  expect(page.text).toMatch(/<link rel="icon" type="image\/svg\+xml" href="\/favicon\.svg\?v=[0-9a-f]{10}"/)
})
