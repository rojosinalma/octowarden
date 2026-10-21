import { placeholders } from '../../templates/values'
import type { Lookups, SectionInfo, ValueField } from '../../views/types'

type Schema = Record<string, unknown>
const WHOLE = /^\$\{\{\s*values\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/
const ANY = /\$\{\{\s*values\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

function deref(node: unknown, root: Schema): Schema | undefined {
  let n = node as Schema | undefined
  for (let i = 0; n && typeof n.$ref === 'string' && i < 10; i++) {
    const path = (n.$ref as string).replace(/^#\//, '').split('/')
    let cur: unknown = root
    for (const p of path) cur = (cur as Record<string, unknown> | undefined)?.[p]
    n = cur as Schema | undefined
  }
  return n
}

function branches(node: Schema | undefined, root: Schema): Schema[] {
  const n = deref(node, root)
  if (!n) return []
  const alts = (n.anyOf ?? n.oneOf) as unknown[] | undefined
  if (Array.isArray(alts)) return alts.flatMap((a) => branches(a as Schema, root))
  return [n]
}

/** Child schema of `node` at `key` (object property, record value or array item). */
function child(node: Schema | undefined, key: string | number, root: Schema): Schema | undefined {
  for (const b of branches(node, root)) {
    if (typeof key === 'number' && b.items) return deref(b.items, root)
    const props = b.properties as Record<string, Schema> | undefined
    if (typeof key === 'string' && props?.[key]) return deref(props[key], root)
    if (typeof key === 'string' && b.additionalProperties && typeof b.additionalProperties === 'object') return deref(b.additionalProperties, root)
  }
  return undefined
}

function lookupFor(path: string[]): keyof Lookups | undefined {
  const words = path.join('.').toLowerCase()
  if (/check|context/.test(words)) return 'checks'
  if (/environment/.test(words)) return 'environments'
  if (/team|reviewer/.test(words)) return 'teams'
  if (/branch|ref_name|\.ref\b/.test(words)) return 'branches'
  return undefined
}

function kindOf(schema: Schema | undefined, root: Schema, path: string[]): Omit<ValueField, 'key' | 'used_in'> {
  const bs = branches(schema, root)
  const lookup = lookupFor(path)
  const last = path[path.length - 1] ?? ''
  if (bs.some((b) => b.type === 'boolean')) return { kind: 'boolean' }
  const en = bs.find((b) => Array.isArray(b.enum))
  if (en) return { kind: 'enum', options: (en.enum as unknown[]).map(String) }
  if (bs.some((b) => b.type === 'array')) return { kind: 'string', multi: true, lookup }
  if (bs.some((b) => b.type === 'integer' || b.type === 'number')) return { kind: 'number' }
  if (/^(content|body|text)$/.test(last)) return { kind: 'text' }
  return { kind: 'string', lookup }
}

/**
 * Every `${{ values.key }}` placeholder in a template's sections with the control that fits it: the JSON
 * Schema at the place it is used decides boolean / number / enum / list, the path decides which repo lookup
 * (branches, checks, teams, environments) offers the choices.
 */
export function valueFields(sections: Record<string, unknown>, infos: SectionInfo[], label: string): ValueField[] {
  const out = new Map<string, ValueField>()
  for (const [name, cfg] of Object.entries(sections)) {
    const info = infos.find((i) => i.name === name)
    const root = (info?.jsonSchema ?? {}) as Schema
    const walk = (node: unknown, schema: Schema | undefined, path: string[]) => {
      if (typeof node === 'string') {
        const whole = WHOLE.exec(node)
        const keys = whole ? [whole[1]!] : [...node.matchAll(ANY)].map((m) => m[1]!)
        for (const key of keys) {
          const k = whole ? kindOf(schema, root, path) : { kind: 'string' as const, lookup: lookupFor(path) }
          const prev = out.get(key)
          if (prev) {
            if (!prev.used_in.includes(`${label}: ${name}`)) prev.used_in.push(`${label}: ${name}`)
            continue
          }
          out.set(key, { key, ...k, used_in: [`${label}: ${name}`] })
        }
        return
      }
      if (Array.isArray(node)) {
        node.forEach((x, i) => {
          // A placeholder that stands for a whole list item of a string list keeps the list's lookup.
          walk(x, child(schema, i, root), path)
        })
        return
      }
      if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) walk(v, child(schema, k, root), [...path, k])
    }
    walk(cfg, deref(root, root), [name])
  }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
}

/** Merges fields of several templates (first kind wins, usages joined). */
export function mergeFields(lists: ValueField[][]): ValueField[] {
  const out = new Map<string, ValueField>()
  for (const list of lists)
    for (const f of list) {
      const prev = out.get(f.key)
      if (prev) prev.used_in = [...new Set([...prev.used_in, ...f.used_in])]
      else out.set(f.key, { ...f, used_in: [...f.used_in] })
    }
  return [...out.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export { placeholders }
