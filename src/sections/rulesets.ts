import { z } from 'zod'
import type { RepoInfo } from '../github/repo'
import { sameValue, type Change, type Section, type SectionContext } from './types'
import { eachChange, listOf, notArchived, statusOf } from './util'

const bool = (text: string) => z.boolean().optional().describe(text)

const statusCheck = z.union([
  z.string().min(1).max(255),
  z.strictObject({
    context: z.string().min(1).max(255).describe('Check run or status name, e.g. the CI job id.'),
    integration_id: z.number().int().positive().optional().describe('Only accept the check from this GitHub App id.'),
  }),
])

const rules = z
  .strictObject({
    creation: bool('Only bypass actors may create matching refs.'),
    update: bool('Only bypass actors may push to matching refs.'),
    deletion: bool('Only bypass actors may delete matching refs.'),
    non_fast_forward: bool('Block force pushes.'),
    required_signatures: bool('Every commit must carry a verified signature.'),
    required_linear_history: bool('No merge commits.'),
    pull_request: z
      .strictObject({
        required_approving_review_count: z.number().int().min(0).max(10).optional().describe('Approvals needed (default 0).'),
        dismiss_stale_reviews_on_push: bool('New commits dismiss approvals.'),
        require_code_owner_review: bool('Code owners must approve.'),
        require_last_push_approval: bool('Someone other than the last pusher must approve.'),
        required_review_thread_resolution: bool('All review threads must be resolved.'),
        allowed_merge_methods: z.array(z.enum(['merge', 'squash', 'rebase'])).min(1).optional().describe('Merge methods allowed for the PR.'),
      })
      .optional()
      .describe('Changes must land through a pull request.'),
    required_status_checks: z
      .strictObject({
        contexts: z
          .union([z.array(statusCheck).max(100), z.string().max(5000)])
          .describe('Required checks: a list, or a comma-separated string (so a `${{ values.* }}` can fill it). Empty drops the rule.'),
        strict: bool('Branches must be up to date before merging.'),
        do_not_enforce_on_create: bool('Allow creating the ref before the checks ran.'),
      })
      .optional()
      .describe('Checks that must pass before a merge.'),
  })
  .describe('Rules; booleans turn a rule on, absent/false leaves it off.')

const actor = z.union([
  z.literal('admin').describe('Shorthand: repository admins (RepositoryRole 5), bypass always.'),
  z.strictObject({
    actor_id: z.number().int().nullable().optional().describe('Role, team, app or deploy key id (null for OrganizationAdmin).'),
    actor_type: z.enum(['RepositoryRole', 'Team', 'Integration', 'OrganizationAdmin', 'DeployKey']),
    bypass_mode: z.enum(['always', 'pull_request']).optional().describe('Default always.'),
  }),
])

const ruleset = z.strictObject({
  name: z.string().min(1).max(100).describe('Ruleset name; matched by name on the repo.'),
  target: z.enum(['branch', 'tag']).optional().describe('Default branch.'),
  enforcement: z.enum(['active', 'evaluate', 'disabled']).optional().describe('Default active (evaluate needs Enterprise).'),
  conditions: z
    .strictObject({
      ref_name: z.strictObject({
        include: z.array(z.string().min(1).max(255)).max(50).optional().describe('Refs: `~DEFAULT_BRANCH`, `~ALL`, `main`, `refs/heads/release/*`.'),
        exclude: z.array(z.string().min(1).max(255)).max(50).optional(),
      }),
    })
    .optional()
    .describe('Default: the default branch.'),
  rules,
  bypass_actors: z.array(actor).max(50).optional().describe('Who may bypass; `admin` for repository admins.'),
  if_branch_exists: bool('Manage this ruleset only when every plain branch it includes exists (e.g. `dev`).'),
})

const config = z
  .strictObject({
    rulesets: z.array(ruleset).max(75).describe('Rulesets, matched by name.'),
    prune: bool('Delete repository rulesets not in this list (destructive).'),
  })
  .describe('Repository rulesets (branch and tag rules). Private repos on GitHub Free cannot use them.')

export type RulesetsConfig = z.infer<typeof config>
export type RulesetSpec = z.infer<typeof ruleset>

/** The ruleset body GitHub takes on POST/PUT, normalized for comparison (sorted lists). */
export type ApiRuleset = {
  name: string
  target: 'branch' | 'tag'
  enforcement: string
  conditions: { ref_name: { include: string[]; exclude: string[] } }
  rules: { type: string; parameters?: Record<string, unknown> }[]
  bypass_actors: { actor_id: number | null; actor_type: string; bypass_mode: string }[]
}

type Detail = Partial<ApiRuleset> & { id: number; name: string; source_type?: string }
export type RulesetsCurrent = { rulesets: Detail[]; missing: Record<string, string[]> }

const BOOL_RULES = ['creation', 'update', 'deletion', 'non_fast_forward', 'required_signatures', 'required_linear_history'] as const

function refName(ref: string, target: 'branch' | 'tag'): string {
  if (ref.startsWith('~') || ref.startsWith('refs/')) return ref
  return `${target === 'tag' ? 'refs/tags' : 'refs/heads'}/${ref}`
}

const byActor = (a: ApiRuleset['bypass_actors'][number], b: ApiRuleset['bypass_actors'][number]) =>
  `${a.actor_type}:${a.actor_id}`.localeCompare(`${b.actor_type}:${b.actor_id}`)

/** Template entry → GitHub body. */
export function toApi(spec: RulesetSpec): ApiRuleset {
  const target = spec.target ?? 'branch'
  const include = spec.conditions?.ref_name.include ?? ['~DEFAULT_BRANCH']
  const exclude = spec.conditions?.ref_name.exclude ?? []
  const out: ApiRuleset['rules'] = []
  for (const t of BOOL_RULES) if (spec.rules[t]) out.push({ type: t })
  const pr = spec.rules.pull_request
  if (pr) {
    out.push({
      type: 'pull_request',
      parameters: {
        required_approving_review_count: pr.required_approving_review_count ?? 0,
        dismiss_stale_reviews_on_push: pr.dismiss_stale_reviews_on_push ?? false,
        require_code_owner_review: pr.require_code_owner_review ?? false,
        require_last_push_approval: pr.require_last_push_approval ?? false,
        required_review_thread_resolution: pr.required_review_thread_resolution ?? false,
        ...(pr.allowed_merge_methods ? { allowed_merge_methods: [...pr.allowed_merge_methods].sort() } : {}),
      },
    })
  }
  const rsc = spec.rules.required_status_checks
  if (rsc) {
    const items = Array.isArray(rsc.contexts) ? rsc.contexts : listOf(rsc.contexts)
    const checks = items
      .map((c) => (typeof c === 'string' ? { context: c.trim() } : c))
      .filter((c) => c.context)
      .sort((a, b) => a.context.localeCompare(b.context))
    if (checks.length) {
      out.push({
        type: 'required_status_checks',
        parameters: {
          required_status_checks: checks,
          strict_required_status_checks_policy: rsc.strict ?? false,
          ...(rsc.do_not_enforce_on_create !== undefined ? { do_not_enforce_on_create: rsc.do_not_enforce_on_create } : {}),
        },
      })
    }
  }
  return {
    name: spec.name,
    target,
    enforcement: spec.enforcement ?? 'active',
    conditions: { ref_name: { include: include.map((r) => refName(r, target)).sort(), exclude: exclude.map((r) => refName(r, target)).sort() } },
    rules: out.sort((a, b) => a.type.localeCompare(b.type)),
    bypass_actors: (spec.bypass_actors ?? [])
      .map((a) =>
        a === 'admin'
          ? { actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }
          : { actor_id: a.actor_id ?? null, actor_type: a.actor_type, bypass_mode: a.bypass_mode ?? 'always' },
      )
      .sort(byActor),
  }
}

function pick(obj: Record<string, unknown> | undefined, like: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(like)) {
    let v = obj?.[k]
    if (k === 'required_status_checks' && Array.isArray(v)) {
      const shape = (like[k] as Record<string, unknown>[]).some((c) => 'integration_id' in c)
      v = (v as { context: string; integration_id?: number }[])
        .map((c) => (shape && c.integration_id !== undefined ? { context: c.context, integration_id: c.integration_id } : { context: c.context }))
        .sort((a, b) => a.context.localeCompare(b.context))
    }
    if (k === 'allowed_merge_methods' && Array.isArray(v)) v = [...v].sort()
    out[k] = v
  }
  return out
}

/** A GitHub ruleset detail projected onto the fields `like` sets, so extra GitHub fields never count as drift. */
export function project(current: Detail, like?: ApiRuleset): ApiRuleset {
  const rules = (current.rules ?? [])
    .map((r) => {
      const want = like?.rules.find((x) => x.type === r.type)
      if (want?.parameters) return { type: r.type, parameters: pick(r.parameters, want.parameters) }
      return like ? { type: r.type } : r
    })
    .sort((a, b) => a.type.localeCompare(b.type))
  return {
    name: current.name,
    target: (current.target ?? 'branch') as ApiRuleset['target'],
    enforcement: current.enforcement ?? 'active',
    conditions: {
      ref_name: {
        include: [...(current.conditions?.ref_name?.include ?? [])].sort(),
        exclude: [...(current.conditions?.ref_name?.exclude ?? [])].sort(),
      },
    },
    rules,
    bypass_actors: (current.bypass_actors ?? [])
      .map((a) => ({ actor_id: a.actor_id ?? null, actor_type: a.actor_type, bypass_mode: a.bypass_mode ?? 'always' }))
      .sort(byActor),
  }
}

function plainBranches(api: ApiRuleset): string[] {
  if (api.target !== 'branch') return []
  return api.conditions.ref_name.include
    .filter((r) => r.startsWith('refs/heads/') && !/[*?[\]]/.test(r))
    .map((r) => r.slice('refs/heads/'.length))
}

async function branchExists(ctx: SectionContext, branch: string): Promise<boolean> {
  try {
    await ctx.gh.request('GET /repos/{owner}/{repo}/branches/{branch}', { owner: ctx.repo.owner, repo: ctx.repo.name, branch })
    return true
  } catch (err) {
    if (statusOf(err) === 404) return false
    throw err
  }
}

async function listRulesets(ctx: SectionContext): Promise<{ id: number; name: string; source_type?: string }[]> {
  const list = await ctx.gh.paginate<{ id: number; name: string; source_type?: string }>('GET /repos/{owner}/{repo}/rulesets', {
    owner: ctx.repo.owner,
    repo: ctx.repo.name,
    includes_parents: false,
  })
  return list.filter((r) => !r.source_type || r.source_type === 'Repository')
}

/** Repository rulesets matched by name; delete only with `prune: true` (destructive). */
export const rulesets: Section<RulesetsConfig, RulesetsCurrent> = {
  name: 'rulesets',
  title: 'Rulesets',
  description: config.description!,
  schema: config,
  mergeKey: 'name',

  async read(ctx, desired) {
    const list = await listRulesets(ctx)
    const details: Detail[] = []
    for (const r of list) {
      const { data } = await ctx.gh.request<Detail>('GET /repos/{owner}/{repo}/rulesets/{ruleset_id}', {
        owner: ctx.repo.owner,
        repo: ctx.repo.name,
        ruleset_id: r.id,
      })
      details.push(data)
    }
    const missing: Record<string, string[]> = {}
    for (const spec of desired?.rulesets ?? []) {
      if (!spec.if_branch_exists) continue
      const gone: string[] = []
      for (const b of plainBranches(toApi(spec))) if (!(await branchExists(ctx, b))) gone.push(b)
      if (gone.length) missing[spec.name] = gone
    }
    return { rulesets: details, missing }
  },

  diff(desired, current) {
    const changes: Change[] = []
    const seen = new Set<string>()
    for (const spec of desired.rulesets) {
      seen.add(spec.name)
      const after = toApi(spec)
      const existing = current.rulesets.find((r) => r.name === spec.name)
      const before = existing ? project(existing, after) : undefined
      const op = !existing ? 'create' : sameValue(before, after) ? 'noop' : 'update'
      const change: Change = { section: 'rulesets', op, target: spec.name, before, after, destructive: false }
      const gone = current.missing[spec.name]
      if (gone?.length && op !== 'noop') change.skip = `branch ${gone.join(', ')} does not exist`
      changes.push(change)
    }
    if (desired.prune) {
      for (const r of current.rulesets) {
        if (seen.has(r.name)) continue
        changes.push({ section: 'rulesets', op: 'delete', target: r.name, before: project(r), destructive: true })
      }
    }
    return changes
  },

  async apply(ctx, changes) {
    const base = { owner: ctx.repo.owner, repo: ctx.repo.name }
    let ids: Map<string, number> | undefined
    const idOf = async (name: string): Promise<number> => {
      ids ??= new Map((await listRulesets(ctx)).map((r) => [r.name, r.id]))
      const id = ids.get(name)
      if (id === undefined) throw new Error(`ruleset "${name}" no longer exists`)
      return id
    }
    return eachChange(changes, async (c) => {
      if (c.op === 'create') {
        const { data } = await ctx.gh.request<{ id: number }>('POST /repos/{owner}/{repo}/rulesets', { ...base, ...(c.after as ApiRuleset) })
        return `ruleset ${c.target} created${data?.id ? ` (id ${data.id})` : ''}`
      }
      const ruleset_id = await idOf(c.target)
      if (c.op === 'delete') {
        await ctx.gh.request('DELETE /repos/{owner}/{repo}/rulesets/{ruleset_id}', { ...base, ruleset_id })
        return `ruleset ${c.target} deleted`
      }
      await ctx.gh.request('PUT /repos/{owner}/{repo}/rulesets/{ruleset_id}', { ...base, ruleset_id, ...(c.after as ApiRuleset) })
      return `ruleset ${c.target} updated`
    })
  },

  supports: (repo: RepoInfo) => notArchived(repo),
}
