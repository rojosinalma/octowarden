import { z } from 'zod'
import { ValidationError } from '../../lib/json'
import { parseYaml, YamlError, type Document } from '../../templates/schema'

export const repo = z.string().describe('Repository as "owner/name"')
export const name = z.string().describe('Template or set name (lowercase, digits, dashes)')
export const values = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).describe('Values for ${{ values.<key> }} placeholders')
export const confirm = z.string().describe('Typed confirmation: must repeat the exact name')

/** One document from `doc` (JSON object) or `yaml` (one YAML document). */
export function oneDocument(args: { doc?: Record<string, unknown>; yaml?: string }, kind: 'Template' | 'Set'): unknown {
  if (args.doc) return args.doc
  if (!args.yaml) throw new ValidationError(`give doc (a ${kind} object) or yaml`)
  let docs: Document[]
  try {
    docs = parseYaml(args.yaml)
  } catch (err) {
    if (err instanceof YamlError) throw new ValidationError(err.message, { issues: err.issues })
    throw err
  }
  if (docs.length !== 1 || docs[0]!.kind !== kind) throw new ValidationError(`yaml must hold exactly one ${kind} document`)
  return docs[0]
}
