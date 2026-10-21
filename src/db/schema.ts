import type { ColumnType, Insertable, Selectable, Updateable } from 'kysely'

/**
 * Column conventions (both engines): ids are text UUIDv7 (time-sortable), timestamps are ISO-8601 UTC text,
 * JSON is stored as text and parsed in src/lib, booleans do not occur in tables.
 */
type Timestamp = string
type JsonText = string

export interface SettingsTable {
  key: string
  value: string
  updated_at: Timestamp
}

export interface TemplatesTable {
  id: string
  name: string
  description: string
  /** JSON: `{ [sectionName]: sectionConfig }` */
  sections: JsonText
  /** JSON: `{ visibility?: 'public' | 'private' | 'any' }` */
  requires: JsonText
  created_at: Timestamp
  updated_at: Timestamp
}

export interface SetsTable {
  id: string
  name: string
  description: string
  /** JSON: ordered template names. */
  template_names: JsonText
  /** JSON: default values for `${{ values.key }}`. */
  values: JsonText
  created_at: Timestamp
  updated_at: Timestamp
}

export interface RepoSetsTable {
  repo: string
  set_name: string
  /** JSON: per-repo values, win over the set's values. */
  values: JsonText
  /** Order of sets on the repo (ascending). */
  position: ColumnType<number, number | undefined, number>
  created_at: Timestamp
}

export type DriftState = 'unknown' | 'clean' | 'drift' | 'error'

export interface ReposTable {
  full_name: string
  /** JSON: cached repo metadata (RepoInfo). */
  metadata: JsonText
  last_audit_at: Timestamp | null
  drift_state: DriftState
  /** JSON: `{ changes, skipped, sections }` from the last audit. */
  drift_summary: JsonText
  updated_at: Timestamp
}

export type RunKind = 'plan' | 'apply' | 'sync' | 'audit'
export type Source = 'ui' | 'cli' | 'api' | 'mcp' | 'scheduler'
export type RunStatus = 'running' | 'ok' | 'failed' | 'partial' | 'drift'

export interface RunsTable {
  id: string
  kind: RunKind
  source: Source
  actor: string
  status: RunStatus
  started_at: Timestamp
  finished_at: Timestamp | null
  /** JSON summary (redacted). */
  summary: JsonText
}

export type EventOutcome = 'applied' | 'skipped' | 'failed' | 'planned' | 'drift' | 'clean' | 'info'

export interface EventsTable {
  id: string
  at: Timestamp
  actor: string
  source: Source
  repo: string | null
  section: string | null
  action: string
  outcome: EventOutcome
  /** JSON redacted `{ before, after }` or null. */
  diff: JsonText | null
  message: string
  run_id: string | null
}

export interface Database {
  settings: SettingsTable
  templates: TemplatesTable
  sets: SetsTable
  repo_sets: RepoSetsTable
  repos: ReposTable
  runs: RunsTable
  events: EventsTable
}

/** Tables in dependency order (adoption copies in this order). */
export const TABLES = ['settings', 'templates', 'sets', 'repo_sets', 'repos', 'runs', 'events'] as const
export type TableName = (typeof TABLES)[number]

export type SettingRow = Selectable<SettingsTable>
export type TemplateRow = Selectable<TemplatesTable>
export type NewTemplateRow = Insertable<TemplatesTable>
export type TemplateUpdate = Updateable<TemplatesTable>
export type SetRow = Selectable<SetsTable>
export type NewSetRow = Insertable<SetsTable>
export type SetUpdate = Updateable<SetsTable>
export type RepoSetRow = Selectable<RepoSetsTable>
export type RepoRow = Selectable<ReposTable>
export type RunRow = Selectable<RunsTable>
export type EventRow = Selectable<EventsTable>
export type NewEventRow = Insertable<EventsTable>
