/**
 * Data shapes the views render. They mirror the services contract (src/services) so views stay pure
 * components that tests can feed with plain objects.
 */
import type { Change } from '../sections/types'

export type Value = string | number | boolean
export type Values = Record<string, Value>

export type RepoView = {
  full_name: string
  owner: string
  name: string
  private: boolean
  visibility: string
  fork: boolean
  archived: boolean
  default_branch: string
  description: string | null
  sets: { set: string; values: Values }[]
  drift_state: 'clean' | 'drift' | 'error' | 'unknown' | string
  drift_summary: unknown
  last_audit_at: string | null
}

export type EventView = {
  id: string
  at: string
  actor: string
  source: string
  repo: string | null
  section: string | null
  action: string
  outcome: string
  diff: unknown
  message: string
  run_id: string | null
}

export type RunView = {
  id: string
  kind: string
  source: string
  actor: string
  status: string
  started_at: string
  finished_at: string | null
  summary: Record<string, unknown>
}

export type TemplateView = {
  name: string
  description: string
  sections: Record<string, unknown>
  requires: { visibility?: string }
  builtin?: boolean
}

export type SetView = {
  name: string
  description: string
  templates: string[]
  values: Values
  builtin?: boolean
}

export type SectionInfo = {
  name: string
  title: string
  description: string
  jsonSchema: unknown
  mergeKey?: string
}

export type Lookups = { branches: string[]; checks: string[]; teams: string[]; environments: string[] }

export type AuthView = {
  mode: string
  source: string
  login?: string
  app_slug?: string
}

export type PlanView = {
  id: string | null
  repo: { full_name: string }
  changes: Change[]
  skipped: { section: string; template?: string; reason: string }[]
  destructive: number
}

/** A `${{ values.key }}` placeholder the repo's templates use, with the control that edits it. */
export type ValueField = {
  key: string
  kind: 'boolean' | 'number' | 'string' | 'enum' | 'text'
  options?: string[]
  /** Pick from the repo's live lookups. */
  lookup?: keyof Lookups
  /** The placeholder stands for a list (comma-joined). */
  multi?: boolean
  used_in: string[]
}
