import type { AnyElysia } from 'elysia'
import { templateToDoc, setToDoc } from '../../templates/library'
import { toYaml } from '../../templates/schema'
import { allSettings } from '../../lib/settings'
import { VERSION } from '../../lib/version'
import * as svc from '../../services'
import { AuditPage, EventsBlock, RunsTable, SINCE, type AuditFilter } from '../../views/audit'
import { RepoPage, type AssignedSetView } from '../../views/repo'
import { owners, ReposPage } from '../../views/repos'
import { SetEditPage, SetsPage } from '../../views/sets'
import { SettingsPage, settingsSubnav } from '../../views/settings'
import { TemplateEditPage, TemplatesPage } from '../../views/templates'
import type { Lookups, SectionInfo, SetView, TemplateView } from '../../views/types'
import { appCredentials } from '../../auth/providers/app'
import { auth, guarded, html, page } from './shared'
import { mergeFields, valueFields } from './values'

const q = (query: Record<string, string | undefined>, k: string) => {
  const v = query[k]
  return typeof v === 'string' && v !== '' ? v.slice(0, 200) : undefined
}

function fieldsFor(set: SetView | undefined, templates: TemplateView[], infos: SectionInfo[]) {
  if (!set) return []
  return mergeFields(set.templates.map((name) => valueFields(templates.find((t) => t.name === name)?.sections ?? {}, infos, name)))
}

const EMPTY_LOOKUPS: Lookups = { branches: [], checks: [], teams: [], environments: [] }

export async function reposPage(): Promise<Response> {
  const [repos, sets, settings] = await Promise.all([
    svc.listRepos().catch((err: Error) => err),
    svc.listSets(),
    allSettings(),
  ])
  const error = repos instanceof Error ? repos.message : undefined
  return page('repos', 'Repos', <ReposPage repos={repos instanceof Error ? [] : repos} sets={sets} defaultOwner={settings.default_owner} error={error} />)
}

export async function repoPage(fullName: string): Promise<Response> {
  const repo = await svc.getRepo(fullName)
  const [sets, templates, lookups] = await Promise.all([
    svc.listSets(),
    svc.listTemplates(),
    svc.repoLookups(fullName).then(
      (l) => ({ l, error: undefined as string | undefined }),
      (err: Error) => ({ l: EMPTY_LOOKUPS, error: err.message }),
    ),
  ])
  const infos = svc.listSectionInfo()
  const assigned: AssignedSetView[] = repo.sets.map((a) => {
    const info = sets.find((s) => s.name === a.set)
    return { set: a.set, values: a.values, info, fields: fieldsFor(info, templates, infos) }
  })
  return page('repos', repo.full_name, <RepoPage repo={repo} assigned={assigned} sets={sets} lookups={lookups.l} lookupError={lookups.error} />)
}

export async function templatesPage(): Promise<Response> {
  const [templates] = await Promise.all([svc.listTemplates()])
  return page('templates', 'Templates', <TemplatesPage templates={templates} sections={svc.listSectionInfo()} />)
}

export async function templateNewPage(from?: string): Promise<Response> {
  const base = from ? await svc.getTemplate(from) : undefined
  const name = base ? `${base.name}-copy`.slice(0, 63) : ''
  const doc = { name, description: base?.description ?? '', sections: base?.sections ?? {}, requires: base?.requires ?? {} }
  const yaml = toYaml(templateToDoc({ ...doc, name: name || 'new-template' }))
  return page('templates', 'New template', <TemplateEditPage doc={doc} sections={svc.listSectionInfo()} yaml={yaml} />)
}

export async function templateEditPage(name: string): Promise<Response> {
  const t = await svc.getTemplate(name)
  const doc = { name: t.name, description: t.description, sections: t.sections, requires: t.requires }
  return page('templates', t.name, <TemplateEditPage name={t.name} doc={doc} sections={svc.listSectionInfo()} builtin={t.builtin} yaml={toYaml(t.doc)} />)
}

async function setEditor(name: string | undefined, doc: SetView, builtin: boolean): Promise<Response> {
  const [templates, repos] = await Promise.all([svc.listTemplates(), svc.listRepos().catch(() => [])])
  const infos = svc.listSectionInfo()
  const fields = Object.fromEntries(templates.map((t) => [t.name, valueFields(t.sections, infos, t.name)]))
  const assignedTo = name ? repos.filter((r) => r.sets.some((s) => s.set === name)).map((r) => r.full_name) : []
  const yaml = toYaml(setToDoc({ ...doc, name: doc.name || 'new-set', templates: doc.templates.length ? doc.templates : ['…'] }))
  return page(
    'sets',
    name ?? 'New set',
    <SetEditPage name={name} doc={doc} templates={templates} fields={fields} repos={repos} assignedTo={assignedTo} builtin={builtin} yaml={yaml} />,
  )
}

export async function setsPage(): Promise<Response> {
  const [sets, repos] = await Promise.all([svc.listSets(), svc.listRepos().catch(() => [])])
  const usage: Record<string, number> = {}
  for (const r of repos) for (const s of r.sets) usage[s.set] = (usage[s.set] ?? 0) + 1
  return page('sets', 'Sets', <SetsPage sets={sets} usage={usage} />)
}

export async function setNewPage(from?: string): Promise<Response> {
  const base = from ? await svc.getSet(from) : undefined
  const doc: SetView = { name: base ? `${base.name}-copy`.slice(0, 63) : '', description: base?.description ?? '', templates: base?.templates ?? [], values: base?.values ?? {} }
  return setEditor(undefined, doc, false)
}

export async function setEditPage(name: string): Promise<Response> {
  const s = await svc.getSet(name)
  return setEditor(s.name, { name: s.name, description: s.description, templates: s.templates, values: s.values }, s.builtin)
}

export async function auditFilter(query: Record<string, string | undefined>): Promise<{ filter: AuditFilter; query: svc.EventQuery }> {
  const filter: AuditFilter = {
    repo: q(query, 'repo'),
    section: q(query, 'section'),
    source: (svc.SOURCES as readonly string[]).includes(q(query, 'source') ?? '') ? q(query, 'source') : undefined,
    actor: q(query, 'actor'),
    outcome: (svc.OUTCOMES as readonly string[]).includes(q(query, 'outcome') ?? '') ? q(query, 'outcome') : undefined,
    since: SINCE.some(([v]) => v && v === q(query, 'since')) ? q(query, 'since') : undefined,
  }
  const since = filter.since ? new Date(Date.now() - Number(filter.since) * 1000).toISOString() : undefined
  return { filter, query: { repo: filter.repo, section: filter.section, source: filter.source, actor: filter.actor, outcome: filter.outcome, since, limit: 500 } }
}

export async function auditPage(query: Record<string, string | undefined>): Promise<Response> {
  const { filter, query: eq } = await auditFilter(query)
  if (query.partial === 'events') return html(await (<EventsBlock events={await svc.listEvents(eq)} />))
  if (query.partial === 'runs') return html(await (<RunsTable runs={await svc.listRuns({ limit: 50 })} />))
  const [events, runs, recent, repos] = await Promise.all([svc.listEvents(eq), svc.listRuns({ limit: 50 }), svc.listEvents({ limit: 500 }), svc.listRepos().catch(() => [])])
  const uniq = (xs: (string | null | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b))
  const sections = uniq([...svc.listSectionInfo().map((s) => s.name), ...recent.map((e) => e.section)])
  return page(
    'audit',
    'Audit',
    <AuditPage
      events={events}
      runs={runs}
      filter={filter}
      repos={uniq([...repos.map((r) => r.full_name), ...recent.map((e) => e.repo), filter.repo])}
      sections={sections}
      actors={uniq([...recent.map((e) => e.actor), filter.actor])}
    />,
  )
}

export async function settingsPage(): Promise<Response> {
  const [settings, a, repos, app] = await Promise.all([svc.listSettings(), auth(), svc.listRepos().catch(() => []), appCredentials().catch(() => undefined)])
  const list = owners(repos, settings.default_owner)
  return page('settings', 'Settings', <SettingsPage settings={settings} auth={a} owners={list} version={VERSION} appReady={app !== undefined} />, { subnav: settingsSubnav(list) })
}

/** Page routes: GET only, HTML. */
export function registerPages<A extends AnyElysia>(app: A): A {
  return app
    .get('/', () => guarded('repos', reposPage))
    .get('/repos', ({ redirect }) => redirect('/', 302))
    .get('/repos/:owner/:name', ({ params }) => guarded('repos', () => repoPage(`${params.owner}/${params.name}`)))
    .get('/templates', () => guarded('templates', templatesPage))
    .get('/templates/new', ({ query }) => guarded('templates', () => templateNewPage(q(query as Record<string, string>, 'from'))))
    .get('/templates/:name', ({ params }) => guarded('templates', () => templateEditPage(params.name)))
    .get('/sets', () => guarded('sets', setsPage))
    .get('/sets/new', ({ query }) => guarded('sets', () => setNewPage(q(query as Record<string, string>, 'from'))))
    .get('/sets/:name', ({ params }) => guarded('sets', () => setEditPage(params.name)))
    .get('/audit', ({ query }) => guarded('audit', () => auditPage(query as Record<string, string>)))
    .get('/settings', () => guarded('settings', settingsPage)) as A
}
