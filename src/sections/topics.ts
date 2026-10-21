import { z } from 'zod'
import { sameValue, type Section } from './types'
import { applied, failed, notArchived } from './util'

const topic = z.string().regex(/^[a-z0-9][a-z0-9-]{0,49}$/, 'lowercase letters, digits and dashes, max 50')

const config = z
  .strictObject({
    topics: z.array(topic).max(20).describe('Repository topics (max 20).'),
    mode: z.enum(['replace', 'add']).optional().describe('replace (default): exactly these topics; add: keep existing ones and add these.'),
  })
  .describe('Repository topics shown on the repo page and used by search.')

export type TopicsConfig = z.infer<typeof config>
export type TopicsCurrent = string[]

/** Topics: one change with the full sorted list; PUT replaces them all. */
export const topics: Section<TopicsConfig, TopicsCurrent> = {
  name: 'topics',
  title: 'Topics',
  description: config.description!,
  schema: config,

  async read(ctx) {
    const { data } = await ctx.gh.request<{ names: string[] }>('GET /repos/{owner}/{repo}/topics', { owner: ctx.repo.owner, repo: ctx.repo.name })
    return [...(data.names ?? [])].sort()
  },

  diff(desired, current) {
    const want = desired.mode === 'add' ? [...new Set([...current, ...desired.topics])] : [...new Set(desired.topics)]
    const after = want.sort()
    return [{ section: 'topics', op: sameValue(current, after) ? 'noop' : 'update', target: 'topics', before: current, after, destructive: false }]
  },

  async apply(ctx, changes) {
    const c = changes[0]
    if (!c) return []
    const names = c.after as string[]
    if (names.length > 20) return [{ change: c, outcome: 'failed', message: `GitHub allows 20 topics, the result has ${names.length}` }]
    try {
      await ctx.gh.request('PUT /repos/{owner}/{repo}/topics', { owner: ctx.repo.owner, repo: ctx.repo.name, names })
      return [applied(c, `topics set: ${names.join(', ') || '(none)'}`)]
    } catch (err) {
      return [failed(c, err)]
    }
  },

  supports: notArchived,
}
