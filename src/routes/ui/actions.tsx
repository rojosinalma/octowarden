import type { AnyElysia } from 'elysia'
import { ValidationError } from '../../lib/json'
import { setDocSchema, templateDocSchema, toYaml, type Document } from '../../templates/schema'
import * as svc from '../../services'
import { PlanDiff } from '../../views/diff'
import { gapCount, GitHubAccess, GitHubStateBadge } from '../../views/github'
import { ApplyReportView } from '../../views/repo'
import { plural } from '../../views/parts'
import type { PlanView } from '../../views/types'
import { listInstallations, setLookups } from './lookups'
import { action, bodyOf, ctxOf, str, strs } from './shared'

const P = '/ui/actions'

const setsBody = (v: unknown): { set: string; values?: svc.RepoSetAssignment['values'] }[] => {
  if (!Array.isArray(v)) throw new ValidationError('sets must be a list')
  return v.map((s) => {
    if (typeof s === 'string') return { set: s }
    const o = s as { set?: unknown; values?: unknown }
    if (typeof o?.set !== 'string') throw new ValidationError('every set needs a name')
    return { set: o.set, values: (o.values ?? {}) as svc.RepoSetAssignment['values'] }
  })
}

/** Preview of a Template/Set document from the editor: YAML always, validity and the first problem. */
function preview(raw: unknown, kind: 'Template' | 'Set') {
  const schema = kind === 'Template' ? templateDocSchema : setDocSchema
  const r = schema.safeParse(raw)
  let yaml: string
  try {
    yaml = toYaml(raw as Document)
  } catch {
    yaml = ''
  }
  if (r.success) return { message: 'valid', valid: true, yaml }
  const first = r.error.issues[0]
  const where = first?.path.map(String).join('.')
  return { message: first ? `${where ? `${where}: ` : ''}${first.message}` : 'invalid', valid: false, yaml }
}

const list = (v: string | undefined) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined)

/** `/ui/actions/*`: JSON `{ok, message, …}` calling the services with source `ui`. */
export function registerActions<A extends AnyElysia>(app: A): A {
  return app
    .post(`${P}/repos/refresh`, () =>
      action(async () => {
        const repos = await svc.listRepos({ refresh: true })
        return { message: `${plural(repos.length, 'repo')} listed from GitHub`, count: repos.length }
      }),
    )
    .post(`${P}/repos`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const ctx = await ctxOf(request)
        const repo = await svc.createRepo(
          { owner: str(b.owner), name: String(b.name ?? ''), private: b.private !== false, description: str(b.description), sets: strs(b.sets)?.map((set) => ({ set })) },
          ctx,
        )
        return { message: `${repo.full_name} created${repo.sets.length ? ` with ${repo.sets.map((s) => s.set).join(', ')}` : ''}`, repo }
      })
    })
    .post(`${P}/repos/delete`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const repo = String(b.repo ?? '')
        await svc.deleteRepo(repo, str(b.confirm), await ctxOf(request))
        return { message: `${repo} deleted on GitHub`, repo }
      })
    })
    .put(`${P}/repos/sets`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const repo = await svc.assignSets(String(b.repo ?? ''), setsBody(b.sets ?? []), await ctxOf(request))
        return { message: repo.sets.length ? `${repo.full_name}: ${repo.sets.map((s) => s.set).join(' → ')}` : `${repo.full_name}: no sets assigned`, repo }
      })
    })
    .get(`${P}/repos/lookups`, ({ query }) =>
      action(async () => {
        const l = await svc.repoLookups(String((query as Record<string, string>).repo ?? ''))
        return { message: 'lookups', ...l }
      }),
    )
    .post(`${P}/plan`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const plan = await svc.createPlan({ repo: String(b.repo ?? ''), sets: strs(b.sets), templates: strs(b.templates) }, await ctxOf(request))
        const view = plan as unknown as PlanView
        return {
          message: plan.changes.length ? `${plan.repo.full_name}: ${plural(plan.changes.length, 'change')} pending` : `${plan.repo.full_name} is in sync`,
          plan: { id: plan.id, repo: plan.repo.full_name, changes: plan.changes.length, destructive: plan.destructive, skipped: plan.skipped.length },
          html: await (<PlanDiff plan={view} />),
        }
      })
    })
    .post(`${P}/apply`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const report = await svc.applyPlan(String(b.plan_id ?? ''), { confirm: str(b.confirm) }, await ctxOf(request))
        const tail = report.failed ? `, ${String(report.failed)} failed` : ''
        return { message: `${report.repo}: ${plural(report.applied, 'change')} applied${tail}`, report, html: await (<ApplyReportView report={report} />) }
      })
    })
    .post(`${P}/bulk`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const mode = String(b.mode ?? '') as svc.BulkMode
        const repos = strs(b.repos) ?? []
        const { run_id } = await svc.startBulk({ repos, sets: strs(b.sets)?.length ? strs(b.sets) : undefined, mode }, await ctxOf(request))
        return { message: `${mode} started on ${plural(repos.length, 'repo')}`, run_id }
      })
    })
    .post(`${P}/audit`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const repos = strs(b.repos)
        const { run_id } = await svc.startAudit({ repos: repos?.length ? repos : undefined }, await ctxOf(request))
        return { message: repos?.length ? `audit started on ${plural(repos.length, 'repo')}` : 'audit started on every assigned repo', run_id }
      })
    })
    .get(`${P}/github/installations`, () =>
      action(async () => {
        const installations = await listInstallations()
        return { message: `${plural(installations.length, 'installation')} found`, installations }
      }),
    )
    .post(`${P}/github/recheck`, () =>
      action(async () => {
        const status = await svc.githubStatus({ refresh: true })
        return { message: svc.statusMessage(status), status, html: await (<GitHubAccess status={status} />), badge: await (<GitHubStateBadge status={status} id="github-state" />), gaps: gapCount(status) }
      }),
    )
    .get(`${P}/sets/lookups`, ({ query }) =>
      action(async () => {
        const r = await setLookups(String((query as Record<string, string>).set ?? ''))
        return { message: `lookups from ${plural(r.repos.length, 'repo')}`, ...r }
      }),
    )
    .get(`${P}/runs/:id`, ({ params }) => action(async () => ({ message: 'run', run: await svc.getRun(params.id) })))
    .post(`${P}/templates/preview`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => preview(b.doc, 'Template'))
    })
    .put(`${P}/templates`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const { template, created } = await svc.saveTemplate(templateDocSchema.parse(b.doc), await ctxOf(request))
        return { message: `template ${template.name} ${created ? 'created' : 'saved'}`, template, created }
      })
    })
    .post(`${P}/templates/delete`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const { deleted } = await svc.deleteTemplate(String(b.name ?? ''), str(b.confirm), await ctxOf(request))
        return { message: `template ${deleted} deleted`, deleted }
      })
    })
    .post(`${P}/sets/preview`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => preview(b.doc, 'Set'))
    })
    .put(`${P}/sets`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const { set, created } = await svc.saveSet(setDocSchema.parse(b.doc), await ctxOf(request))
        return { message: `set ${set.name} ${created ? 'created' : 'saved'}`, set, created }
      })
    })
    .post(`${P}/sets/delete`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const { deleted } = await svc.deleteSet(String(b.name ?? ''), str(b.confirm), await ctxOf(request))
        return { message: `set ${deleted} deleted`, deleted }
      })
    })
    .post(`${P}/sets/assign`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const set = String(b.set ?? '')
        const add = new Set(strs(b.add) ?? [])
        const remove = new Set(strs(b.remove) ?? [])
        const ctx = await ctxOf(request)
        const repos = await svc.listRepos()
        let changed = 0
        for (const name of new Set([...add, ...remove])) {
          const current = repos.find((r) => r.full_name === name)?.sets ?? []
          const has = current.some((s) => s.set === set)
          if (add.has(name) && !has) await svc.assignSets(name, [...current, { set, values: {} }], ctx)
          else if (remove.has(name) && has) await svc.assignSets(name, current.filter((s) => s.set !== set), ctx)
          else continue
          changed++
        }
        return { message: changed ? `${set}: ${plural(changed, 'repo')} updated` : `${set}: nothing to change`, changed }
      })
    })
    .post(`${P}/import`, async ({ request }) => {
      const type = request.headers.get('content-type') ?? ''
      const text = type.includes('json') ? String((await bodyOf(request)).yaml ?? '') : await request.text()
      return action(async () => {
        const counts = await svc.importYaml(text, await ctxOf(request))
        return { message: `imported ${plural(counts.templates, 'template')}, ${plural(counts.sets, 'set')}, ${plural(counts.repos, 'repo assignment')}`, counts }
      })
    })
    .put(`${P}/settings`, async ({ request }) => {
      const b = await bodyOf(request)
      return action(async () => {
        const key = String(b.key ?? '')
        const value = typeof b.value === 'boolean' ? String(b.value) : String(b.value ?? '')
        const settings = await svc.updateSettings({ [key]: value }, await ctxOf(request))
        return { message: value === '' ? `${key.replace(/_/g, ' ')} cleared` : `${key.replace(/_/g, ' ')} saved`, value: settings[key as keyof typeof settings] }
      })
    })
    .get('/ui/export', async ({ query }) => {
      const qq = query as Record<string, string | undefined>
      try {
        let templates = list(qq.templates)
        const sets = list(qq.sets)
        if (qq.with === 'templates' && sets) {
          const extra: string[] = []
          for (const s of sets) extra.push(...(await svc.getSet(s)).templates)
          templates = [...new Set([...(templates ?? []), ...extra])]
        }
        if (qq.all === 'templates') templates = (await svc.listTemplates()).filter((t) => !t.builtin).map((t) => t.name)
        const yaml = qq.all === 'templates' && !templates?.length ? '' : await svc.exportYaml({ templates, sets, manifest: qq.manifest === '1' })
        const file = sets?.length === 1 && !qq.all ? `${sets[0]}.yaml` : templates?.length === 1 && !sets ? `${templates[0]}.yaml` : 'octowarden.yaml'
        return new Response(yaml || '# nothing to export yet\n', { headers: { 'content-type': 'text/yaml; charset=utf-8', 'content-disposition': `attachment; filename="${file.replace(/[^A-Za-z0-9._-]/g, '_')}"` } })
      } catch (err) {
        return Response.json({ ok: false, message: (err as Error).message }, { status: 404 })
      }
    }) as A
}
