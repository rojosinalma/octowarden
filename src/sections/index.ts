import { files } from './files'
import { githooks } from './githooks'
import { labels } from './labels'
import { protection } from './protection'
import { rulesets } from './rulesets'
import { security } from './security'
import { settings } from './settings'
import { topics } from './topics'
import type { AnySection } from './types'
import { webhooks } from './webhooks'

/** One line per section; order here is the order plans read and apply them. */
export const SECTIONS: Record<string, AnySection> = {
  settings,
  security,
  rulesets,
  protection,
  labels,
  topics,
  webhooks,
  files,
  githooks,
}

export function getSection(name: string): AnySection | undefined {
  return Object.hasOwn(SECTIONS, name) ? SECTIONS[name] : undefined
}

export function listSections(): AnySection[] {
  return Object.values(SECTIONS)
}

export function sectionNames(): string[] {
  return Object.keys(SECTIONS)
}

/** Registry position, so merged section maps apply in a stable order whatever the template order. */
export function sectionOrder(name: string): number {
  const i = Object.keys(SECTIONS).indexOf(name)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}
