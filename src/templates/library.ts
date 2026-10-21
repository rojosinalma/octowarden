import type { Document, SetDoc, TemplateDoc, Visibility } from './schema'
import { API_VERSION } from './schema'
import type { Values } from './values'

export type Template = {
  name: string
  description: string
  sections: Record<string, unknown>
  requires: { visibility?: Visibility }
}

export type TemplateSet = {
  name: string
  description: string
  /** Applied in this order; later templates win. */
  templates: string[]
  values: Values
}

/** Where the engine looks up templates and sets: the DB (`dbLibrary`) or YAML files (`memoryLibrary`). */
export interface Library {
  getTemplate(name: string): Promise<Template | undefined>
  getSet(name: string): Promise<TemplateSet | undefined>
}

export function templateFromDoc(doc: TemplateDoc): Template {
  return {
    name: doc.metadata.name,
    description: doc.metadata.description ?? '',
    sections: doc.spec.sections,
    requires: doc.spec.requires ?? {},
  }
}

export function setFromDoc(doc: SetDoc): TemplateSet {
  return { name: doc.metadata.name, description: doc.metadata.description ?? '', templates: doc.spec.templates, values: doc.spec.values ?? {} }
}

export function templateToDoc(t: Template): TemplateDoc {
  return {
    apiVersion: API_VERSION,
    kind: 'Template',
    metadata: { name: t.name, ...(t.description ? { description: t.description } : {}) },
    spec: { sections: t.sections, ...(t.requires.visibility ? { requires: { visibility: t.requires.visibility } } : {}) },
  }
}

export function setToDoc(s: TemplateSet): SetDoc {
  return {
    apiVersion: API_VERSION,
    kind: 'Set',
    metadata: { name: s.name, ...(s.description ? { description: s.description } : {}) },
    spec: { templates: s.templates, ...(Object.keys(s.values).length ? { values: s.values } : {}) },
  }
}

/** Library over parsed YAML documents (standalone CLI, tests). Manifests are ignored here. */
export function memoryLibrary(docs: Document[]): Library {
  const templates = new Map<string, Template>()
  const sets = new Map<string, TemplateSet>()
  for (const d of docs) {
    if (d.kind === 'Template') templates.set(d.metadata.name, templateFromDoc(d))
    else if (d.kind === 'Set') sets.set(d.metadata.name, setFromDoc(d))
  }
  return {
    getTemplate: async (name) => templates.get(name),
    getSet: async (name) => sets.get(name),
  }
}
