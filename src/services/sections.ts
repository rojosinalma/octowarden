import { z } from 'zod'
import { log } from '../lib/log'
import { listSections } from '../sections'

export type SectionInfo = { name: string; title: string; description: string; jsonSchema: Record<string, unknown>; mergeKey?: string }

const logger = log.child('http')
let cache: SectionInfo[] | undefined

/** Every registered section with its config as JSON Schema (for forms, MCP and docs). */
export function listSectionInfo(): SectionInfo[] {
  if (cache && cache.length === listSections().length) return cache
  cache = listSections().map((s) => {
    let jsonSchema: Record<string, unknown> = {}
    try {
      jsonSchema = z.toJSONSchema(s.schema, { unrepresentable: 'any', io: 'input' }) as Record<string, unknown>
    } catch (err) {
      logger.warn(`section ${s.name}: no JSON Schema (${(err as Error).message})`)
    }
    return { name: s.name, title: s.title, description: s.description, jsonSchema, ...(s.mergeKey ? { mergeKey: s.mergeKey } : {}) }
  })
  return cache
}
