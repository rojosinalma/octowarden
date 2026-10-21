import { getSection, sectionOrder } from '../sections'

/**
 * Deep merge for one section config: objects merge key by key, scalars and arrays from `next` replace,
 * except arrays of objects that all carry `mergeKey`: those merge item by item (later wins, new items appended).
 */
export function mergeConfig(base: unknown, next: unknown, mergeKey?: string): unknown {
  if (Array.isArray(base) && Array.isArray(next) && mergeKey && keyed(base, mergeKey) && keyed(next, mergeKey)) {
    const out = base.map((x) => ({ ...(x as Record<string, unknown>) }))
    for (const item of next as Record<string, unknown>[]) {
      const i = out.findIndex((x) => x[mergeKey] === item[mergeKey])
      if (i === -1) out.push(item)
      else out[i] = mergeConfig(out[i], item, mergeKey) as Record<string, unknown>
    }
    return out
  }
  if (isPlain(base) && isPlain(next)) {
    const out: Record<string, unknown> = { ...base }
    for (const [k, v] of Object.entries(next)) out[k] = k in out ? mergeConfig(out[k], v, mergeKey) : v
    return out
  }
  return next
}

function isPlain(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function keyed(list: unknown[], key: string): boolean {
  return list.every((x) => isPlain(x) && key in x)
}

/** Merges the section maps of several templates in order (later wins); result keys follow registry order. */
export function mergeSections(list: Record<string, unknown>[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const sections of list) {
    for (const [name, cfg] of Object.entries(sections)) {
      merged[name] = name in merged ? mergeConfig(merged[name], cfg, getSection(name)?.mergeKey) : cfg
    }
  }
  return Object.fromEntries(Object.entries(merged).sort(([a], [b]) => sectionOrder(a) - sectionOrder(b)))
}
