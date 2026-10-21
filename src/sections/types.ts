import type { ZodType } from 'zod'
import type { GitHubClient } from '../github/client'
import type { RepoInfo } from '../github/repo'
import type { Logger } from '../lib/log'

export type { RepoInfo } from '../github/repo'

export type SectionContext = {
  gh: GitHubClient
  repo: RepoInfo
  /** True during plan/audit: read only, never write. */
  dryRun: boolean
  log: Logger
}

export type ChangeOp = 'create' | 'update' | 'delete' | 'noop'

export type Change = {
  section: string
  op: ChangeOp
  /** What changes inside the section: a field (`has_wiki`), a label name, a ruleset name, a file path, a webhook URL. */
  target: string
  before?: unknown
  after?: unknown
  /** Deletes or overwrites something that cannot be restored from the template (needs confirm = repo full name). */
  destructive: boolean
  reason?: string
  /**
   * Set by `diff` when this target cannot be managed on this repo (feature not on the plan, branch missing).
   * The engine moves such a change from `changes` into `plan.skipped` with this reason.
   */
  skip?: string
}

export type ApplyOutcome = 'applied' | 'skipped' | 'failed'
export type ApplyResult = { change: Change; outcome: ApplyOutcome; message: string }

export type Support = { ok: true } | { ok: false; reason: string }

/**
 * One configurable area of a repo. Register in src/sections/index.ts.
 * - `schema` validates the section config after `${{ values.* }}` substitution (prefer strict objects).
 * - `mergeKey`: arrays of objects in the config whose items all carry this key merge by it across templates
 *   (labels `name`, rulesets `name`, webhooks `url`, files `path`); other arrays replace.
 * - `read` throws GitHubError; a plan/visibility limit (see `isPlanLimit`) makes the engine skip the section.
 * - `diff` is pure: returns one Change per target, `noop` included.
 * - `apply` receives only non-noop changes of this section and returns one ApplyResult per change; it may
 *   return `skipped` with a reason for a change the repo's plan does not allow.
 * - `read` gets the validated desired config as second argument (sections that read per target need it:
 *   files by path, protection by branch); callers without one (tests, lookups) may omit it.
 * - `expand` (optional) runs on the merged raw config before `${{ values.* }}` substitution, so content it
 *   pulls in (built-in file bodies) gets its placeholders substituted too.
 * - `applyWith` (optional) names another section whose `apply` receives this section's changes together with
 *   its own in one call (githooks → files: one commit for both).
 */
export interface Section<C = unknown, Current = unknown> {
  name: string
  title: string
  description: string
  schema: ZodType<C>
  mergeKey?: string
  read(ctx: SectionContext, desired?: C): Promise<Current>
  diff(desired: C, current: Current, repo: RepoInfo): Change[]
  apply(ctx: SectionContext, changes: Change[]): Promise<ApplyResult[]>
  supports?(repo: RepoInfo): Support
  expand?(raw: unknown): unknown
  applyWith?: string
}

/** Type-erased section, the shape stored in the registry. */
export type AnySection = Section<any, any>

/** Builds a noop/update change for one field with deep equality. */
export function fieldChange(section: string, target: string, before: unknown, after: unknown, destructive = false): Change {
  return { section, op: sameValue(before, after) ? 'noop' : 'update', target, before, after, destructive }
}

/** Structural equality for JSON values (key order ignored). */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a)) {
    const bb = b as unknown[]
    return a.length === bb.length && a.every((x, i) => sameValue(x, bb[i]))
  }
  const ka = Object.keys(a as object)
  const kb = Object.keys(b as object)
  return ka.length === kb.length && ka.every((k) => sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}
