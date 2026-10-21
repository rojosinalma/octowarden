import { NotFoundError, ValidationError } from '../lib/json'
import { templateFromDoc, setFromDoc, type Library, type Template, type TemplateSet } from '../templates/library'
import type { SetDoc } from '../templates/schema'
import { dbLibrary, listAssignments } from '../templates/store'
import type { Values } from '../templates/values'
import type { Resolved, Target } from './types'

async function template(library: Library, name: string, from?: string): Promise<Template> {
  const t = await library.getTemplate(name)
  if (!t) throw new NotFoundError(`template "${name}" not found${from ? ` (used by set "${from}")` : ''}`)
  return t
}

/** A set by name or document, with its templates looked up in order. */
export async function resolveSet(nameOrDoc: string | SetDoc, library: Library = dbLibrary): Promise<{ set: TemplateSet; templates: Template[] }> {
  const set = typeof nameOrDoc === 'string' ? await library.getSet(nameOrDoc) : setFromDoc(nameOrDoc)
  if (!set) throw new NotFoundError(`set "${nameOrDoc}" not found`)
  const templates: Template[] = []
  for (const name of set.templates) templates.push(await template(library, name, set.name))
  return { set, templates }
}

/**
 * Turns a Target into ordered templates and values. Value precedence (low → high):
 * set values → per-repo assignment values → `target.values`.
 */
export async function resolveTarget(repo: string, target: Target, library: Library = dbLibrary): Promise<Resolved> {
  const sets: string[] = []
  const templates: Template[] = []
  let values: Values = {}
  const addSet = async (nameOrDoc: string | SetDoc, extra: Values = {}) => {
    const r = await resolveSet(nameOrDoc, library)
    sets.push(r.set.name)
    templates.push(...r.templates)
    values = { ...values, ...r.set.values, ...extra }
  }

  if (target.doc?.kind === 'Template') templates.push(templateFromDoc(target.doc))
  else if (target.doc?.kind === 'Set') await addSet(target.doc)
  else if (target.sets?.length || target.templates?.length) {
    for (const s of target.sets ?? []) await addSet(s)
    for (const t of target.templates ?? []) templates.push(await template(library, t))
  } else {
    const assigned = await listAssignments(repo)
    if (!assigned.length) throw new ValidationError(`${repo} has no sets assigned; name sets or templates`)
    for (const a of assigned) await addSet(a.set_name, a.values)
  }
  return { sets, templates, values: { ...values, ...(target.values ?? {}) } }
}
