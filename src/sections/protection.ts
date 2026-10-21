import { z } from 'zod'
import { sameValue, type Change, type Section, type SectionContext } from './types'
import { eachChange, listOf, notArchived, statusOf } from './util'

const bool = (text: string) => z.boolean().optional().describe(text)

const branch = z.strictObject({
  branch: z.string().min(1).max(255).describe('Branch name, or `~DEFAULT_BRANCH`.'),
  required_status_checks: z
    .union([
      z.null(),
      z.strictObject({
        strict: bool('Branch must be up to date before merging.'),
        contexts: z
          .union([z.array(z.string().min(1).max(255)).max(100), z.string().max(5000)])
          .describe('Required checks: a list or a comma-separated string. Empty turns the requirement off.'),
      }),
    ])
    .optional()
    .describe('Status checks that must pass; null turns it off.'),
  enforce_admins: bool('Apply the rules to admins too.'),
  required_pull_request_reviews: z
    .union([
      z.null(),
      z.strictObject({
        required_approving_review_count: z.number().int().min(0).max(6).optional().describe('Approvals needed (default 0).'),
        dismiss_stale_reviews: bool('New commits dismiss approvals.'),
        require_code_owner_reviews: bool('Code owners must approve.'),
        require_last_push_approval: bool('Someone other than the last pusher must approve.'),
      }),
    ])
    .optional()
    .describe('Changes must land through a reviewed pull request; null turns it off.'),
  required_linear_history: bool('No merge commits.'),
  allow_force_pushes: bool('Allow force pushes.'),
  allow_deletions: bool('Allow deleting the branch.'),
  required_conversation_resolution: bool('All review threads must be resolved.'),
  required_signatures: bool('Every commit must carry a verified signature.'),
})

const config = z
  .strictObject({ branches: z.array(branch).max(50).describe('Protected branches, matched by name.') })
  .describe('Classic branch protection, for repos that do not use rulesets. Private repos on GitHub Free cannot use it.')

export type ProtectionConfig = z.infer<typeof config>
type BranchSpec = z.infer<typeof branch>

type Reviews = { required_approving_review_count: number; dismiss_stale_reviews: boolean; require_code_owner_reviews: boolean; require_last_push_approval: boolean }

/** The PUT body (plus `required_signatures`, which has its own endpoint), normalized for comparison. */
export type Protection = {
  required_status_checks: { strict: boolean; contexts: string[] } | null
  enforce_admins: boolean
  required_pull_request_reviews: Reviews | null
  required_linear_history: boolean
  allow_force_pushes: boolean
  allow_deletions: boolean
  required_conversation_resolution: boolean
  required_signatures: boolean
}

/** Per branch: null = not protected, 'missing' = no such branch. */
export type ProtectionCurrent = Record<string, Protection | null | 'missing'>

const UNPROTECTED: Protection = {
  required_status_checks: null,
  enforce_admins: false,
  required_pull_request_reviews: null,
  required_linear_history: false,
  allow_force_pushes: false,
  allow_deletions: false,
  required_conversation_resolution: false,
  required_signatures: false,
}

type Enabled = { enabled?: boolean } | undefined
type ProtectionResponse = {
  required_status_checks?: { strict?: boolean; contexts?: string[] }
  enforce_admins?: Enabled
  required_pull_request_reviews?: Partial<Reviews>
  required_linear_history?: Enabled
  allow_force_pushes?: Enabled
  allow_deletions?: Enabled
  required_conversation_resolution?: Enabled
  required_signatures?: Enabled
}

export function normalize(data: ProtectionResponse): Protection {
  const on = (e: Enabled) => e?.enabled === true
  const r = data.required_pull_request_reviews
  return {
    required_status_checks: data.required_status_checks
      ? { strict: data.required_status_checks.strict ?? false, contexts: [...(data.required_status_checks.contexts ?? [])].sort() }
      : null,
    enforce_admins: on(data.enforce_admins),
    required_pull_request_reviews: r
      ? {
          required_approving_review_count: r.required_approving_review_count ?? 0,
          dismiss_stale_reviews: r.dismiss_stale_reviews ?? false,
          require_code_owner_reviews: r.require_code_owner_reviews ?? false,
          require_last_push_approval: r.require_last_push_approval ?? false,
        }
      : null,
    required_linear_history: on(data.required_linear_history),
    allow_force_pushes: on(data.allow_force_pushes),
    allow_deletions: on(data.allow_deletions),
    required_conversation_resolution: on(data.required_conversation_resolution),
    required_signatures: on(data.required_signatures),
  }
}

/** Desired fields over the current state (unset fields keep what the branch has). */
export function overlay(spec: BranchSpec, current: Protection): Protection {
  const out: Protection = structuredClone(current)
  const rsc = spec.required_status_checks
  if (rsc === null) out.required_status_checks = null
  else if (rsc) {
    const contexts = listOf(rsc.contexts).sort()
    out.required_status_checks = contexts.length ? { strict: rsc.strict ?? current.required_status_checks?.strict ?? false, contexts } : null
  }
  const rv = spec.required_pull_request_reviews
  if (rv === null) out.required_pull_request_reviews = null
  else if (rv) {
    const cur = current.required_pull_request_reviews
    out.required_pull_request_reviews = {
      required_approving_review_count: rv.required_approving_review_count ?? cur?.required_approving_review_count ?? 0,
      dismiss_stale_reviews: rv.dismiss_stale_reviews ?? cur?.dismiss_stale_reviews ?? false,
      require_code_owner_reviews: rv.require_code_owner_reviews ?? cur?.require_code_owner_reviews ?? false,
      require_last_push_approval: rv.require_last_push_approval ?? cur?.require_last_push_approval ?? false,
    }
  }
  for (const k of ['enforce_admins', 'required_linear_history', 'allow_force_pushes', 'allow_deletions', 'required_conversation_resolution', 'required_signatures'] as const) {
    if (spec[k] !== undefined) out[k] = spec[k]!
  }
  return out
}

const branchName = (b: string, ctx: { default_branch: string }) => (b === '~DEFAULT_BRANCH' ? ctx.default_branch : b)

async function readBranch(ctx: SectionContext, branch: string): Promise<Protection | null | 'missing'> {
  try {
    const { data } = await ctx.gh.request<ProtectionResponse>('GET /repos/{owner}/{repo}/branches/{branch}/protection', {
      owner: ctx.repo.owner,
      repo: ctx.repo.name,
      branch,
    })
    return normalize(data)
  } catch (err) {
    if (statusOf(err) !== 404) throw err
    return /branch not found/i.test((err as Error).message) ? 'missing' : null
  }
}

/** Classic branch protection per branch; never removes protection. */
export const protection: Section<ProtectionConfig, ProtectionCurrent> = {
  name: 'protection',
  title: 'Branch protection',
  description: config.description!,
  schema: config,
  mergeKey: 'branch',

  async read(ctx, desired) {
    const out: ProtectionCurrent = {}
    for (const spec of desired?.branches ?? []) {
      const b = branchName(spec.branch, ctx.repo)
      if (!(b in out)) out[b] = await readBranch(ctx, b)
    }
    return out
  },

  diff(desired, current, repo) {
    return desired.branches.map((spec): Change => {
      const b = branchName(spec.branch, repo)
      const cur = current[b]
      if (cur === 'missing') return { section: 'protection', op: 'create', target: b, destructive: false, skip: `branch ${b} does not exist` }
      const before = cur ?? undefined
      const after = overlay(spec, cur ?? UNPROTECTED)
      const op = !cur ? 'create' : sameValue(cur, after) ? 'noop' : 'update'
      return { section: 'protection', op, target: b, before, after, destructive: false }
    })
  },

  async apply(ctx, changes) {
    return eachChange(changes, async (c) => {
      const p = c.after as Protection
      const before = c.before as Protection | undefined
      const base = { owner: ctx.repo.owner, repo: ctx.repo.name, branch: c.target }
      const { required_signatures, ...body } = p
      await ctx.gh.request('PUT /repos/{owner}/{repo}/branches/{branch}/protection', { ...base, ...body, restrictions: null })
      if (required_signatures !== (before?.required_signatures ?? false)) {
        await ctx.gh.request(`${required_signatures ? 'POST' : 'DELETE'} /repos/{owner}/{repo}/branches/{branch}/protection/required_signatures`, base)
      }
      return `${c.target} protection ${c.op === 'create' ? 'created' : 'updated'}`
    })
  },

  supports: notArchived,
}
