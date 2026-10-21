import { builtinDocs, builtinLibrary, layeredLibrary } from '../templates/builtin'
import { setFromDoc, templateFromDoc, type Library, type Template, type TemplateSet } from '../templates/library'
import type { Document } from '../templates/schema'
import { dbLibrary } from '../templates/store'

/** Built-in starter documents (Templates and Sets), read-only. */
export async function builtinDocuments(): Promise<Document[]> {
  return builtinDocs()
}

export async function builtinTemplates(): Promise<Template[]> {
  return builtinDocs().flatMap((d) => (d.kind === 'Template' ? [templateFromDoc(d)] : []))
}

export async function builtinSets(): Promise<TemplateSet[]> {
  return builtinDocs().flatMap((d) => (d.kind === 'Set' ? [setFromDoc(d)] : []))
}

export async function builtinTemplate(name: string): Promise<Template | undefined> {
  return builtinLibrary().getTemplate(name)
}

export async function builtinSet(name: string): Promise<TemplateSet | undefined> {
  return builtinLibrary().getSet(name)
}

/** Server library: the DB first, then the built-ins (built-in names are reserved, so nothing is shadowed). */
export const serverLibrary: Library = {
  getTemplate: (name) => layeredLibrary(dbLibrary, builtinLibrary()).getTemplate(name),
  getSet: (name) => layeredLibrary(dbLibrary, builtinLibrary()).getSet(name),
}
