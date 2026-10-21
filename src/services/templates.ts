import { recordEvent } from '../lib/events'
import { ConflictError, NotFoundError } from '../lib/json'
import { templateToDoc, type Template } from '../templates/library'
import { templateDocSchema, type TemplateDoc } from '../templates/schema'
import * as store from '../templates/store'
import { requireConfirm, type Ctx } from './context'
import { builtinTemplate, builtinTemplates, builtinSets } from './library'

/** A template as the UI/API sees it; built-ins are read-only and have no timestamps. */
export type TemplateInfo = Template & { builtin: boolean; created_at: string | null; updated_at: string | null }
export type TemplateDetail = TemplateInfo & { doc: TemplateDoc; used_by: string[] }

function info(t: Template, builtin: boolean, stamps?: { created_at: string; updated_at: string }): TemplateInfo {
  return {
    name: t.name,
    description: t.description,
    sections: t.sections,
    requires: t.requires,
    builtin,
    created_at: stamps?.created_at ?? null,
    updated_at: stamps?.updated_at ?? null,
  }
}

/** DB templates and the built-in starter templates (`builtin: true`), by name. */
export async function listTemplates(): Promise<TemplateInfo[]> {
  const stored = (await store.listTemplates()).map((t) => info(t, false, t))
  const names = new Set(stored.map((t) => t.name))
  const builtins = (await builtinTemplates()).filter((t) => !names.has(t.name)).map((t) => info(t, true))
  return [...stored, ...builtins].sort((a, b) => a.name.localeCompare(b.name))
}

/** Sets (DB and built-in) that list the template. */
async function setsUsing(name: string): Promise<string[]> {
  const sets = [...(await store.listSets()), ...(await builtinSets())]
  return [...new Set(sets.filter((s) => s.templates.includes(name)).map((s) => s.name))].sort()
}

export async function getTemplate(name: string): Promise<TemplateDetail> {
  const stored = await store.getTemplate(name)
  const base = stored ? info(stored, false, stored) : await builtinTemplate(name).then((t) => t && info(t, true))
  if (!base) throw new NotFoundError(`template "${name}" not found`)
  return { ...base, doc: templateToDoc(base), used_by: await setsUsing(name) }
}

/** Validates and stores a Template document (insert or replace by name). Built-in names are reserved. */
export async function saveTemplate(doc: TemplateDoc, ctx: Ctx): Promise<{ template: TemplateInfo; created: boolean }> {
  const valid = templateDocSchema.parse(doc)
  const name = valid.metadata.name
  if (await builtinTemplate(name)) throw new ConflictError(`template "${name}" is built in and read-only; save it under another name`)
  const { template, created } = await store.saveTemplate(valid)
  await recordEvent({
    actor: ctx.actor,
    source: ctx.source,
    action: created ? 'template.create' : 'template.update',
    outcome: 'info',
    diff: { sections: Object.keys(valid.spec.sections) },
    message: `template ${name} ${created ? 'created' : 'updated'}`,
  })
  return { template: info(template, false, template), created }
}

/** Deletes a DB template; `confirm` must equal the name; refused while a set still lists it. */
export async function deleteTemplate(name: string, confirm: string | undefined, ctx: Ctx): Promise<{ deleted: string }> {
  if (!(await store.getTemplate(name))) {
    if (await builtinTemplate(name)) throw new ConflictError(`template "${name}" is built in and cannot be deleted`)
    throw new NotFoundError(`template "${name}" not found`)
  }
  requireConfirm(name, confirm, `delete template ${name}`)
  const users = await setsUsing(name)
  if (users.length) throw new ConflictError(`template "${name}" is used by sets: ${users.join(', ')}`, { used_by: users })
  await store.deleteTemplate(name)
  await recordEvent({ actor: ctx.actor, source: ctx.source, action: 'template.delete', outcome: 'info', message: `template ${name} deleted` })
  return { deleted: name }
}
