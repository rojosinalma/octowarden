import { recordEvent } from '../lib/events'
import { ConflictError, NotFoundError, ValidationError } from '../lib/json'
import { REDACT_PATTERN } from '../lib/log'
import { isSettingKey } from '../lib/settings'
import { sameValue } from '../sections/types'
import { setToDoc, templateToDoc, type Template, type TemplateSet } from '../templates/library'
import { API_VERSION, parseYaml, toYaml, YamlError, type Document, type ManifestDoc, type SetDoc, type TemplateDoc } from '../templates/schema'
import * as store from '../templates/store'
import type { Values } from '../templates/values'
import type { Ctx } from './context'
import { builtinSet, builtinTemplate, serverLibrary } from './library'
import { checkSetTemplates } from './sets'
import { assignSets } from './repos'

export type ExportRequest = { templates?: string[]; sets?: string[]; manifest?: boolean }
export type ImportCounts = { templates: number; sets: number; repos: number }

const PLACEHOLDER_RE = /^\$\{\{\s*values\.[A-Za-z_][A-Za-z0-9_]*\s*\}\}$/

function valueKey(key: string): string {
  const k = key.replace(/[^A-Za-z0-9_]/g, '_')
  return /^[A-Za-z_]/.test(k) ? k : `_${k}`
}

/**
 * Template sections without secrets: a string under a secret-looking key (token, secret, password, …)
 * becomes `${{ values.<key> }}` unless it already is a placeholder or names a settings key (a reference).
 */
export function scrubSections(node: unknown, depth = 0): unknown {
  if (depth > 32 || node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map((x) => scrubSections(x, depth + 1))
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
    if (REDACT_PATTERN.test(k) && typeof v === 'string' && v !== '' && !PLACEHOLDER_RE.test(v) && !isSettingKey(v)) out[k] = `\${{ values.${valueKey(k)} }}`
    else if (REDACT_PATTERN.test(k) && v !== null && typeof v !== 'object' && typeof v !== 'string') continue
    else out[k] = scrubSections(v, depth + 1)
  }
  return out
}

/** Values without secret-looking keys. */
export function scrubValues(values: Values): Values {
  return Object.fromEntries(Object.entries(values).filter(([k]) => !REDACT_PATTERN.test(k)))
}

function templateDoc(t: Template): TemplateDoc {
  return templateToDoc({ ...t, sections: scrubSections(t.sections) as Record<string, unknown> })
}

function setDoc(s: TemplateSet): SetDoc {
  return setToDoc({ ...s, values: scrubValues(s.values) })
}

async function manifestDoc(): Promise<ManifestDoc> {
  const byRepo = new Map<string, { sets: string[]; values: Values }>()
  for (const a of await store.listAllAssignments()) {
    const e = byRepo.get(a.repo) ?? { sets: [], values: {} }
    e.sets.push(a.set_name)
    Object.assign(e.values, scrubValues(a.values))
    byRepo.set(a.repo, e)
  }
  return {
    apiVersion: API_VERSION,
    kind: 'Manifest',
    metadata: { name: 'repos' },
    spec: {
      repos: [...byRepo].map(([repo, e]) => ({ repo, sets: e.sets, ...(Object.keys(e.values).length ? { values: e.values } : {}) })),
    },
  }
}

/**
 * Multi-document YAML (`apiVersion: octowarden/v1`). Without names: every DB template and set
 * (built-ins only when named). `manifest` adds a Manifest of the repo assignments. Never holds a secret.
 */
export async function exportYaml(req: ExportRequest = {}): Promise<string> {
  const docs: Document[] = []
  const named = Boolean(req.templates?.length || req.sets?.length)
  if (named) {
    for (const name of req.templates ?? []) {
      const t = await serverLibrary.getTemplate(name)
      if (!t) throw new NotFoundError(`template "${name}" not found`)
      docs.push(templateDoc(t))
    }
    for (const name of req.sets ?? []) {
      const s = await serverLibrary.getSet(name)
      if (!s) throw new NotFoundError(`set "${name}" not found`)
      docs.push(setDoc(s))
    }
  } else if (!req.manifest) {
    for (const t of await store.listTemplates()) docs.push(templateDoc(t))
    for (const s of await store.listSets()) docs.push(setDoc(s))
  }
  if (req.manifest) docs.push(await manifestDoc())
  return docs.length ? toYaml(docs) : ''
}

/**
 * Imports Templates, Sets and Manifests (templates first, then sets, then repo assignments). Everything is
 * validated before the first write. Built-in names are accepted only when the content is identical (skipped).
 */
export async function importYaml(text: string, ctx: Ctx): Promise<ImportCounts> {
  let docs: Document[]
  try {
    docs = parseYaml(text)
  } catch (err) {
    if (err instanceof YamlError) throw new ValidationError(err.message, { document: err.index + 1, issues: err.issues })
    throw err
  }
  if (!docs.length) throw new ValidationError('no documents in the YAML')

  const templates: TemplateDoc[] = []
  const sets: SetDoc[] = []
  const manifests: ManifestDoc[] = []
  for (const d of docs) {
    if (d.kind === 'Template') {
      const b = await builtinTemplate(d.metadata.name)
      if (b) {
        if (!sameValue(templateToDoc(b), d)) throw new ConflictError(`template "${d.metadata.name}" is built in; rename it to import it`)
        continue
      }
      templates.push(d)
    } else if (d.kind === 'Set') {
      const b = await builtinSet(d.metadata.name)
      if (b) {
        if (!sameValue(setToDoc(b), d)) throw new ConflictError(`set "${d.metadata.name}" is built in; rename it to import it`)
        continue
      }
      sets.push(d)
    } else manifests.push(d)
  }

  const newTemplates = new Set(templates.map((t) => t.metadata.name))
  for (const s of sets) await checkSetTemplates(s, newTemplates)
  const newSets = new Set(sets.map((s) => s.metadata.name))
  for (const m of manifests) {
    for (const r of m.spec.repos) {
      const missing: string[] = []
      for (const s of r.sets) if (!newSets.has(s) && !(await serverLibrary.getSet(s))) missing.push(s)
      if (missing.length) throw new ValidationError(`manifest repo ${r.repo} lists unknown sets: ${missing.join(', ')}`, { missing })
    }
  }

  for (const t of templates) await store.saveTemplate(t)
  for (const s of sets) await store.saveSet(s)
  let repos = 0
  for (const m of manifests) {
    for (const r of m.spec.repos) {
      await assignSets(r.repo, r.sets.map((set) => ({ set, values: r.values ?? {} })), ctx)
      repos++
    }
  }
  const counts = { templates: templates.length, sets: sets.length, repos }
  await recordEvent({ actor: ctx.actor, source: ctx.source, action: 'import', outcome: 'info', diff: counts, message: `imported ${counts.templates} templates, ${counts.sets} sets, ${counts.repos} repos` })
  return counts
}
