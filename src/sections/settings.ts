import { z } from 'zod'
import { fieldChange, type ApplyResult, type Change, type Section } from './types'

const config = z.strictObject({
  description: z.string().max(350).optional(),
  homepage: z.union([z.literal(''), z.url({ protocol: /^https?$/ })]).optional(),
  default_branch: z.string().min(1).max(255).optional(),
  has_issues: z.boolean().optional(),
  has_projects: z.boolean().optional(),
  has_wiki: z.boolean().optional(),
  has_discussions: z.boolean().optional(),
  allow_merge_commit: z.boolean().optional(),
  allow_squash_merge: z.boolean().optional(),
  allow_rebase_merge: z.boolean().optional(),
  allow_auto_merge: z.boolean().optional(),
  allow_update_branch: z.boolean().optional(),
  delete_branch_on_merge: z.boolean().optional(),
  squash_merge_commit_title: z.enum(['PR_TITLE', 'COMMIT_OR_PR_TITLE']).optional(),
  squash_merge_commit_message: z.enum(['PR_BODY', 'COMMIT_MESSAGES', 'BLANK']).optional(),
  merge_commit_title: z.enum(['PR_TITLE', 'MERGE_MESSAGE']).optional(),
  merge_commit_message: z.enum(['PR_BODY', 'PR_TITLE', 'BLANK']).optional(),
})

export type SettingsConfig = z.infer<typeof config>
export type SettingsField = keyof SettingsConfig
export type SettingsCurrent = Partial<Record<SettingsField, unknown>>

export const SETTINGS_FIELDS = Object.keys(config.shape) as SettingsField[]

/** GitHub answers null for an empty description/homepage. */
function normalize(field: SettingsField, value: unknown): unknown {
  if ((field === 'description' || field === 'homepage') && value == null) return ''
  return value
}

/** Repo settings: merge buttons, commit message defaults, features, description, homepage, default branch. */
export const settings: Section<SettingsConfig, SettingsCurrent> = {
  name: 'settings',
  title: 'Repository settings',
  description: 'Merge methods, merge commit messages, branch clean-up, auto-merge, features, description, homepage and default branch.',
  schema: config,

  async read(ctx) {
    const { data } = await ctx.gh.request<Record<string, unknown>>('GET /repos/{owner}/{repo}', { owner: ctx.repo.owner, repo: ctx.repo.name })
    const out: SettingsCurrent = {}
    for (const f of SETTINGS_FIELDS) out[f] = normalize(f, data[f])
    return out
  },

  diff(desired, current) {
    const changes: Change[] = []
    for (const f of SETTINGS_FIELDS) {
      if (desired[f] === undefined) continue
      changes.push(fieldChange('settings', f, current[f], desired[f]))
    }
    return changes
  },

  async apply(ctx, changes) {
    const body: Record<string, unknown> = {}
    for (const c of changes) body[c.target] = c.after
    if (!Object.keys(body).length) return []
    try {
      await ctx.gh.request('PATCH /repos/{owner}/{repo}', { owner: ctx.repo.owner, repo: ctx.repo.name, ...body })
      return changes.map((change): ApplyResult => ({ change, outcome: 'applied', message: `${change.target} set` }))
    } catch (err) {
      const message = (err as Error).message
      return changes.map((change): ApplyResult => ({ change, outcome: 'failed', message }))
    }
  },

  supports(repo) {
    return repo.archived ? { ok: false, reason: 'repository is archived' } : { ok: true }
  },
}
