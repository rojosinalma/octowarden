import { z } from 'zod'
import type { Change, Section } from './types'
import { eachChange, notArchived } from './util'

const label = z.strictObject({
  name: z.string().min(1).max(50).describe('Label name; matched case-insensitively.'),
  color: z
    .string()
    .regex(/^#?[0-9a-fA-F]{6}$/, 'six hex digits, e.g. d73a4a')
    .describe('Hex colour, with or without #.'),
  description: z.string().max(100).optional().describe('Short description (max 100).'),
})

const config = z
  .strictObject({
    labels: z.array(label).max(200).describe('Labels, matched by name.'),
    prune: z.boolean().optional().describe('Delete labels not in this list (destructive: removes them from issues and PRs).'),
  })
  .describe('Issue and pull request labels.')

export type LabelsConfig = z.infer<typeof config>
export type Label = { name: string; color: string; description: string }
export type LabelsCurrent = Label[]

const key = (name: string) => name.toLowerCase()
const color = (c: string) => c.replace(/^#/, '').toLowerCase()

/** Labels by name; `prune` removes the rest (destructive). Renames in case only update the name. */
export const labels: Section<LabelsConfig, LabelsCurrent> = {
  name: 'labels',
  title: 'Labels',
  description: config.description!,
  schema: config,
  mergeKey: 'name',

  async read(ctx) {
    const list = await ctx.gh.paginate<{ name: string; color: string; description: string | null }>('GET /repos/{owner}/{repo}/labels', {
      owner: ctx.repo.owner,
      repo: ctx.repo.name,
    })
    return list.map((l) => ({ name: l.name, color: color(l.color), description: l.description ?? '' }))
  },

  diff(desired, current) {
    const changes: Change[] = []
    const byKey = new Map(current.map((l) => [key(l.name), l]))
    const seen = new Set<string>()
    for (const want of desired.labels) {
      const k = key(want.name)
      if (seen.has(k)) continue
      seen.add(k)
      const have = byKey.get(k)
      const after: Label = { name: want.name, color: color(want.color), description: want.description ?? have?.description ?? '' }
      if (!have) {
        changes.push({ section: 'labels', op: 'create', target: want.name, after, destructive: false })
        continue
      }
      const same = have.name === after.name && have.color === after.color && have.description === after.description
      changes.push({ section: 'labels', op: same ? 'noop' : 'update', target: have.name, before: have, after, destructive: false })
    }
    if (desired.prune) {
      for (const l of current) {
        if (!seen.has(key(l.name))) changes.push({ section: 'labels', op: 'delete', target: l.name, before: l, destructive: true })
      }
    }
    return changes
  },

  async apply(ctx, changes) {
    const base = { owner: ctx.repo.owner, repo: ctx.repo.name }
    return eachChange(changes, async (c) => {
      const after = c.after as Label | undefined
      if (c.op === 'create') {
        await ctx.gh.request('POST /repos/{owner}/{repo}/labels', { ...base, ...after })
        return `label ${c.target} created`
      }
      if (c.op === 'delete') {
        await ctx.gh.request('DELETE /repos/{owner}/{repo}/labels/{name}', { ...base, name: c.target })
        return `label ${c.target} deleted`
      }
      await ctx.gh.request('PATCH /repos/{owner}/{repo}/labels/{name}', {
        ...base,
        name: c.target,
        new_name: after!.name,
        color: after!.color,
        description: after!.description,
      })
      return `label ${c.target} updated`
    })
  },

  supports: notArchived,
}
