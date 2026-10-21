import { db } from '../db'
import { recordEvent } from '../lib/events'
import { ConflictError, NotFoundError, ValidationError } from '../lib/json'
import { setToDoc, type TemplateSet } from '../templates/library'
import { setDocSchema, type SetDoc } from '../templates/schema'
import * as store from '../templates/store'
import { requireConfirm, type Ctx } from './context'
import { builtinSet, builtinSets, serverLibrary } from './library'

export type SetInfo = TemplateSet & { builtin: boolean; created_at: string | null; updated_at: string | null }
export type SetDetail = SetInfo & { doc: SetDoc; repos: string[] }

function info(s: TemplateSet, builtin: boolean, stamps?: { created_at: string; updated_at: string }): SetInfo {
  return {
    name: s.name,
    description: s.description,
    templates: s.templates,
    values: s.values,
    builtin,
    created_at: stamps?.created_at ?? null,
    updated_at: stamps?.updated_at ?? null,
  }
}

export async function listSets(): Promise<SetInfo[]> {
  const stored = (await store.listSets()).map((s) => info(s, false, s))
  const names = new Set(stored.map((s) => s.name))
  const builtins = (await builtinSets()).filter((s) => !names.has(s.name)).map((s) => info(s, true))
  return [...stored, ...builtins].sort((a, b) => a.name.localeCompare(b.name))
}

/** Repos the set is assigned to. */
export async function reposUsingSet(name: string): Promise<string[]> {
  const rows = await db().selectFrom('repo_sets').select('repo').where('set_name', '=', name).orderBy('repo').limit(10_000).execute()
  return rows.map((r) => r.repo)
}

export async function getSet(name: string): Promise<SetDetail> {
  const stored = await store.getSet(name)
  const base = stored ? info(stored, false, stored) : await builtinSet(name).then((s) => s && info(s, true))
  if (!base) throw new NotFoundError(`set "${name}" not found`)
  return { ...base, doc: setToDoc(base), repos: await reposUsingSet(name) }
}

/** Every template a set lists must exist (DB or built-in). */
export async function checkSetTemplates(doc: SetDoc, extra: ReadonlySet<string> = new Set()): Promise<void> {
  const missing: string[] = []
  for (const t of doc.spec.templates) if (!extra.has(t) && !(await serverLibrary.getTemplate(t))) missing.push(t)
  if (missing.length) throw new ValidationError(`set "${doc.metadata.name}" lists unknown templates: ${missing.join(', ')}`, { missing })
}

export async function saveSet(doc: SetDoc, ctx: Ctx): Promise<{ set: SetInfo; created: boolean }> {
  const valid = setDocSchema.parse(doc)
  const name = valid.metadata.name
  if (await builtinSet(name)) throw new ConflictError(`set "${name}" is built in and read-only; save it under another name`)
  await checkSetTemplates(valid)
  const { set, created } = await store.saveSet(valid)
  await recordEvent({
    actor: ctx.actor,
    source: ctx.source,
    action: created ? 'set.create' : 'set.update',
    outcome: 'info',
    diff: { templates: valid.spec.templates, values: Object.keys(valid.spec.values ?? {}) },
    message: `set ${name} ${created ? 'created' : 'updated'}`,
  })
  return { set: info(set, false, set), created }
}

/** Deletes a DB set; `confirm` must equal the name; refused while repos still have it assigned. */
export async function deleteSet(name: string, confirm: string | undefined, ctx: Ctx): Promise<{ deleted: string }> {
  if (!(await store.getSet(name))) {
    if (await builtinSet(name)) throw new ConflictError(`set "${name}" is built in and cannot be deleted`)
    throw new NotFoundError(`set "${name}" not found`)
  }
  requireConfirm(name, confirm, `delete set ${name}`)
  const repos = await reposUsingSet(name)
  if (repos.length) throw new ConflictError(`set "${name}" is assigned to ${repos.length} repos; unassign it first`, { repos: repos.slice(0, 50) })
  await store.deleteSet(name)
  await recordEvent({ actor: ctx.actor, source: ctx.source, action: 'set.delete', outcome: 'info', message: `set ${name} deleted` })
  return { deleted: name }
}
