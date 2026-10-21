import type { DriftState, RunStatus, Source } from '../db/schema'
import type { GitHubClient } from '../github/client'
import type { GitHubStatus } from '../github/status'
import type { RepoInfo } from '../github/repo'
import type { ApplyResult, Change } from '../sections/types'
import type { Library, Template } from '../templates/library'
import type { SetDoc, TemplateDoc } from '../templates/schema'
import type { Values } from '../templates/values'

/** Who asked: `source` is the interface, `actor` a readable name (API token name, GitHub login, `scheduler`). */
export type Origin = { source: Source; actor: string }

/** What to apply. Without sets/templates/doc the repo's assigned sets (repo_sets) are used. */
export type Target = {
  sets?: string[]
  templates?: string[]
  doc?: TemplateDoc | SetDoc
  /** Win over set values and per-repo values. */
  values?: Values
}

export type EngineOptions = {
  /** Default: the resolved auth provider's client. */
  gh?: GitHubClient
  /** Default: the DB library. */
  library?: Library
  /** Record runs/events (default true; always off when no DB is connected). */
  record?: boolean
  /**
   * GitHub access status used to skip sections the credential definitely cannot manage. Default: the cached
   * status (src/github/status.ts) when `gh` is not given; `false` turns the check off.
   */
  access?: GitHubStatus | false
}

export type PlanInput = Target & Origin & EngineOptions & { repo: string }

export type Resolved = { sets: string[]; templates: Template[]; values: Values }

/** A section (or one `target` inside it) left out of the plan, with the reason. */
export type Skipped = { section: string; template?: string; target?: string; reason: string }
export type SectionSummary = { section: string; changes: number; noop: number; skipped?: string }

export type Plan = {
  /** Run id when recorded, else null. */
  id: string | null
  repo: RepoInfo
  sets: string[]
  templates: string[]
  values: Values
  /** Section configs after merge and substitution. */
  desired: Record<string, unknown>
  /** Pending changes only (noops are counted in `sections`). */
  changes: Change[]
  skipped: Skipped[]
  sections: SectionSummary[]
  /** Number of destructive changes; apply needs `confirm === repo.full_name` when > 0. */
  destructive: number
  created_at: string
}

export type ApplyOptions = Origin &
  Pick<EngineOptions, 'gh' | 'record'> & {
    /** Must equal the repo full name when the plan holds destructive changes. */
    confirm?: string
    kind?: 'apply' | 'sync'
  }

export type ApplyReport = {
  run_id: string | null
  repo: string
  status: RunStatus
  results: ApplyResult[]
  skipped: Skipped[]
  applied: number
  failed: number
}

export type Drift = {
  run_id: string | null
  repo: string
  state: DriftState
  changes: Change[]
  skipped: Skipped[]
  checked_at: string
  message: string
}
