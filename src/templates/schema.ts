import { parseAllDocuments, stringify } from 'yaml'
import { z } from 'zod'
import { getSection } from '../sections'
import { placeholders } from './values'

export const API_VERSION = 'octowarden/v1'
export const MAX_DOCUMENTS = 500
export const MAX_YAML_BYTES = 5 * 1024 * 1024

export const nameSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'lowercase letters, digits and dashes, max 63')
export const repoNameSchema = z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, 'owner/name')
export const valueSchema = z.union([z.string().max(10_000), z.number(), z.boolean()])
export const valuesSchema = z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'letters, digits, _'), valueSchema)
export const visibilitySchema = z.enum(['public', 'private', 'any'])

const metadata = z.strictObject({ name: nameSchema, description: z.string().max(1000).optional() })

/**
 * Section configs are checked against each section's schema here when they hold no `${{ values.* }}`
 * placeholder; with placeholders the check runs at plan time, after substitution.
 */
export const sectionsSchema = z.record(z.string(), z.unknown()).superRefine((sections, ctx) => {
  for (const [name, cfg] of Object.entries(sections)) {
    const section = getSection(name)
    if (!section) {
      ctx.addIssue({ code: 'custom', path: [name], message: `unknown section "${name}"` })
      continue
    }
    if (placeholders(cfg).size) continue
    const r = section.schema.safeParse(cfg)
    if (!r.success) for (const i of r.error.issues) ctx.addIssue({ code: 'custom', path: [name, ...i.path.map(String)], message: i.message })
  }
})

export const templateDocSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal('Template'),
  metadata,
  spec: z.strictObject({
    sections: sectionsSchema,
    requires: z.strictObject({ visibility: visibilitySchema.optional() }).optional(),
  }),
})

export const setDocSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal('Set'),
  metadata,
  spec: z.strictObject({
    templates: z.array(nameSchema).min(1).max(100),
    values: valuesSchema.optional(),
  }),
})

export const manifestDocSchema = z.strictObject({
  apiVersion: z.literal(API_VERSION),
  kind: z.literal('Manifest'),
  metadata: z.strictObject({ name: nameSchema.optional(), description: z.string().max(1000).optional() }).optional(),
  spec: z.strictObject({
    repos: z
      .array(z.strictObject({ repo: repoNameSchema, sets: z.array(nameSchema).min(1).max(50), values: valuesSchema.optional() }))
      .max(5000),
  }),
})

export const documentSchema = z.discriminatedUnion('kind', [templateDocSchema, setDocSchema, manifestDocSchema])

export type TemplateDoc = z.infer<typeof templateDocSchema>
export type SetDoc = z.infer<typeof setDocSchema>
export type ManifestDoc = z.infer<typeof manifestDocSchema>
export type Document = z.infer<typeof documentSchema>
export type Visibility = z.infer<typeof visibilitySchema>

export class YamlError extends Error {
  constructor(
    message: string,
    readonly index: number,
    readonly issues: { path: string; message: string }[] = [],
  ) {
    super(message)
    this.name = 'YamlError'
  }
}

/** Parses one or more `---`-separated documents and validates each; throws YamlError naming the document. */
export function parseYaml(text: string): Document[] {
  if (text.length > MAX_YAML_BYTES) throw new YamlError(`YAML too large (max ${MAX_YAML_BYTES} bytes)`, 0)
  const docs = parseAllDocuments(text)
  const list = Array.isArray(docs) ? docs : [docs]
  if (list.length > MAX_DOCUMENTS) throw new YamlError(`too many documents (max ${MAX_DOCUMENTS})`, MAX_DOCUMENTS)
  const out: Document[] = []
  list.forEach((d, index) => {
    if (d.errors.length) throw new YamlError(`document ${index + 1}: ${d.errors[0]!.message}`, index)
    const raw = d.toJS({ maxAliasCount: 100 })
    if (raw == null) return
    const r = documentSchema.safeParse(raw)
    if (!r.success) {
      const issues = r.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
      const first = issues[0]!
      throw new YamlError(`document ${index + 1}: ${first.path ? `${first.path}: ` : ''}${first.message}`, index, issues)
    }
    out.push(r.data)
  })
  return out
}

/** Renders documents as one YAML stream (`---` between them). */
export function toYaml(docs: Document | Document[]): string {
  return (Array.isArray(docs) ? docs : [docs]).map((d) => stringify(d, { lineWidth: 0 })).join('---\n')
}
