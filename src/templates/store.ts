import { db } from '../db'
import type { RepoSetRow, SetRow, TemplateRow } from '../db/schema'
import { newId, nowIso, parseJson, toJson } from '../db/util'
import { templateFromDoc, setFromDoc, type Library, type Template, type TemplateSet } from './library'
import type { SetDoc, TemplateDoc } from './schema'
import type { Values } from './values'

export type StoredTemplate = Template & { id: string; created_at: string; updated_at: string }
export type StoredSet = TemplateSet & { id: string; created_at: string; updated_at: string }
export type RepoAssignment = { repo: string; set_name: string; values: Values; position: number }

const LIST_MAX = 1000

function toTemplate(r: TemplateRow): StoredTemplate {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    sections: parseJson(r.sections, {}),
    requires: parseJson(r.requires, {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

function toSet(r: SetRow): StoredSet {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    templates: parseJson(r.template_names, []),
    values: parseJson(r.values, {}),
    created_at: r.created_at,
    updated_at: r.updated_at,
  }
}

export async function listTemplates(): Promise<StoredTemplate[]> {
  return (await db().selectFrom('templates').selectAll().orderBy('name').limit(LIST_MAX).execute()).map(toTemplate)
}

export async function getTemplate(name: string): Promise<StoredTemplate | undefined> {
  const r = await db().selectFrom('templates').selectAll().where('name', '=', name).executeTakeFirst()
  return r && toTemplate(r)
}

/** Insert or replace by name (the doc is already validated). Returns whether it was created. */
export async function saveTemplate(doc: TemplateDoc): Promise<{ template: StoredTemplate; created: boolean }> {
  const t = templateFromDoc(doc)
  const now = nowIso()
  const existing = await getTemplate(t.name)
  const values = { description: t.description, sections: toJson(t.sections), requires: toJson(t.requires), updated_at: now }
  if (existing) await db().updateTable('templates').set(values).where('name', '=', t.name).execute()
  else await db().insertInto('templates').values({ id: newId(), name: t.name, created_at: now, ...values }).execute()
  return { template: (await getTemplate(t.name))!, created: !existing }
}

export async function deleteTemplate(name: string): Promise<boolean> {
  const r = await db().deleteFrom('templates').where('name', '=', name).executeTakeFirst()
  return Number(r.numDeletedRows) > 0
}

export async function listSets(): Promise<StoredSet[]> {
  return (await db().selectFrom('sets').selectAll().orderBy('name').limit(LIST_MAX).execute()).map(toSet)
}

export async function getSet(name: string): Promise<StoredSet | undefined> {
  const r = await db().selectFrom('sets').selectAll().where('name', '=', name).executeTakeFirst()
  return r && toSet(r)
}

export async function saveSet(doc: SetDoc): Promise<{ set: StoredSet; created: boolean }> {
  const s = setFromDoc(doc)
  const now = nowIso()
  const existing = await getSet(s.name)
  const values = { description: s.description, template_names: toJson(s.templates), values: toJson(s.values), updated_at: now }
  if (existing) await db().updateTable('sets').set(values).where('name', '=', s.name).execute()
  else await db().insertInto('sets').values({ id: newId(), name: s.name, created_at: now, ...values }).execute()
  return { set: (await getSet(s.name))!, created: !existing }
}

export async function deleteSet(name: string): Promise<boolean> {
  const r = await db().deleteFrom('sets').where('name', '=', name).executeTakeFirst()
  return Number(r.numDeletedRows) > 0
}

function toAssignment(r: RepoSetRow): RepoAssignment {
  return { repo: r.repo, set_name: r.set_name, values: parseJson(r.values, {}), position: r.position }
}

/** Sets assigned to a repo, in apply order. */
export async function listAssignments(repo: string): Promise<RepoAssignment[]> {
  const rows = await db().selectFrom('repo_sets').selectAll().where('repo', '=', repo).orderBy('position').orderBy('set_name').execute()
  return rows.map(toAssignment)
}

/** Every assignment (scheduler: which repos to audit). */
export async function listAllAssignments(): Promise<RepoAssignment[]> {
  const rows = await db().selectFrom('repo_sets').selectAll().orderBy('repo').orderBy('position').limit(50_000).execute()
  return rows.map(toAssignment)
}

export async function assignSet(repo: string, setName: string, values: Values = {}, position = 0): Promise<void> {
  await db()
    .insertInto('repo_sets')
    .values({ repo, set_name: setName, values: toJson(values), position, created_at: nowIso() })
    .onConflict((oc) => oc.columns(['repo', 'set_name']).doUpdateSet({ values: toJson(values), position }))
    .execute()
}

export async function unassignSet(repo: string, setName: string): Promise<boolean> {
  const r = await db().deleteFrom('repo_sets').where('repo', '=', repo).where('set_name', '=', setName).executeTakeFirst()
  return Number(r.numDeletedRows) > 0
}

/** Library over the DB. */
export const dbLibrary: Library = { getTemplate, getSet }
