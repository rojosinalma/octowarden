/** Scalar a placeholder can stand for. */
export type Value = string | number | boolean
export type Values = Record<string, Value>

/** `${{ values.key }}`, spaces optional. */
const PLACEHOLDER = /\$\{\{\s*values\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const WHOLE = /^\$\{\{\s*values\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/

/** Every value key referenced anywhere in `node`. */
export function placeholders(node: unknown, out = new Set<string>()): Set<string> {
  if (typeof node === 'string') for (const m of node.matchAll(PLACEHOLDER)) out.add(m[1]!)
  else if (Array.isArray(node)) for (const x of node) placeholders(x, out)
  else if (node && typeof node === 'object') for (const x of Object.values(node)) placeholders(x, out)
  return out
}

export class MissingValuesError extends Error {
  constructor(readonly missing: string[]) {
    super(`missing values: ${missing.join(', ')}`)
    this.name = 'MissingValuesError'
  }
}

/**
 * Replaces placeholders. A string that is exactly one placeholder takes the value's type (`true`, `3`);
 * a placeholder inside a longer string interpolates. Throws MissingValuesError naming every missing key.
 */
export function substitute<T>(node: T, values: Values): T {
  const missing = [...placeholders(node)].filter((k) => !Object.hasOwn(values, k))
  if (missing.length) throw new MissingValuesError(missing.sort())
  const walk = (n: unknown): unknown => {
    if (typeof n === 'string') {
      const whole = WHOLE.exec(n)
      if (whole) return values[whole[1]!]
      return n.replace(PLACEHOLDER, (_, k: string) => String(values[k]))
    }
    if (Array.isArray(n)) return n.map(walk)
    if (n && typeof n === 'object') return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, walk(v)]))
    return n
  }
  return walk(node) as T
}
