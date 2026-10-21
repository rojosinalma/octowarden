import { z } from 'zod'
import { config as appConfig } from '../lib/config'
import { getSetting } from '../lib/settings'
import { sameValue, type Change, type Section, type SectionContext } from './types'
import { eachChange, notArchived } from './util'

/** Where a webhook secret may come from: the settings key, or an env var named WEBHOOK_SECRET or WEBHOOK_SECRET_*. */
export const SECRET_REF = /^(github_webhook_secret|WEBHOOK_SECRET(_[A-Z0-9_]+)?)$/

const hook = z.strictObject({
  url: z.url({ protocol: /^https$/ }).max(2000).describe('Payload URL (https only); matched by URL.'),
  events: z.array(z.string().regex(/^(\*|[a-z_]+)$/, 'GitHub event name')).min(1).max(100).optional().describe('Events (default push; `*` = all).'),
  content_type: z.enum(['json', 'form']).optional().describe('Payload format (default json).'),
  active: z.boolean().optional().describe('Deliver events (default true).'),
  insecure_ssl: z.literal(false).optional().describe('TLS verification always stays on.'),
  secret_ref: z
    .string()
    .regex(SECRET_REF, 'github_webhook_secret, WEBHOOK_SECRET or WEBHOOK_SECRET_<NAME>')
    .optional()
    .describe('Name of the setting `github_webhook_secret` or an env var WEBHOOK_SECRET[_<NAME>] holding the secret; never the secret itself.'),
})

const config = z
  .strictObject({
    hooks: z.array(hook).max(20).describe('Webhooks, matched by URL.'),
    prune: z.boolean().optional().describe('Delete webhooks not in this list (destructive).'),
  })
  .describe('Repository webhooks. Secrets come by reference from settings or the environment.')

export type WebhooksConfig = z.infer<typeof config>

/** Comparable webhook state; `has_secret` because GitHub never returns the secret itself. */
export type Hook = { url: string; events: string[]; content_type: string; active: boolean; insecure_ssl: boolean; has_secret: boolean }
type HookResponse = { id: number; name?: string; active: boolean; events: string[]; config: { url?: string; content_type?: string; insecure_ssl?: string | number; secret?: string } }
export type WebhooksCurrent = (Hook & { id: number })[]

/** The secret for a ref; undefined when unset. Read at apply time only, never stored in a change. */
export async function resolveSecret(ref: string): Promise<string | undefined> {
  if (!SECRET_REF.test(ref)) return undefined
  if (ref === 'github_webhook_secret') return (await getSetting('github_webhook_secret')) || appConfig().githubWebhookSecret || undefined
  return Bun.env[ref] || undefined
}

async function list(ctx: SectionContext): Promise<HookResponse[]> {
  const hooks = await ctx.gh.paginate<HookResponse>('GET /repos/{owner}/{repo}/hooks', { owner: ctx.repo.owner, repo: ctx.repo.name })
  return hooks.filter((h) => !h.name || h.name === 'web')
}

/** Webhooks by URL; `prune` deletes the rest (destructive). A changed secret value is not detectable. */
export const webhooks: Section<WebhooksConfig, WebhooksCurrent> = {
  name: 'webhooks',
  title: 'Webhooks',
  description: config.description!,
  schema: config,
  mergeKey: 'url',

  async read(ctx) {
    return (await list(ctx)).map((h) => ({
      id: h.id,
      url: h.config.url ?? '',
      events: [...h.events].sort(),
      content_type: h.config.content_type ?? 'form',
      active: h.active,
      insecure_ssl: String(h.config.insecure_ssl ?? '0') === '1',
      has_secret: Boolean(h.config.secret),
    }))
  },

  diff(desired, current) {
    const changes: Change[] = []
    const seen = new Set<string>()
    for (const want of desired.hooks) {
      if (seen.has(want.url)) continue
      seen.add(want.url)
      const after: Hook & { secret_ref?: string } = {
        url: want.url,
        events: [...new Set(want.events ?? ['push'])].sort(),
        content_type: want.content_type ?? 'json',
        active: want.active ?? true,
        insecure_ssl: false,
        has_secret: want.secret_ref !== undefined,
        ...(want.secret_ref ? { secret_ref: want.secret_ref } : {}),
      }
      const have = current.find((h) => h.url === want.url)
      if (!have) {
        changes.push({ section: 'webhooks', op: 'create', target: want.url, after, destructive: false })
        continue
      }
      const { id: _id, ...before } = have
      const { secret_ref: _ref, ...comparable } = after
      changes.push({ section: 'webhooks', op: sameValue(before, comparable) ? 'noop' : 'update', target: want.url, before, after, destructive: false })
    }
    if (desired.prune) {
      for (const h of current) {
        if (seen.has(h.url)) continue
        const { id: _id, ...before } = h
        changes.push({ section: 'webhooks', op: 'delete', target: h.url, before, destructive: true })
      }
    }
    return changes
  },

  async apply(ctx, changes) {
    const base = { owner: ctx.repo.owner, repo: ctx.repo.name }
    let ids: Map<string, number> | undefined
    const idOf = async (url: string) => {
      ids ??= new Map((await list(ctx)).map((h) => [h.config.url ?? '', h.id]))
      const id = ids.get(url)
      if (id === undefined) throw new Error('webhook no longer exists')
      return id
    }
    return eachChange(changes, async (c) => {
      if (c.op === 'delete') {
        await ctx.gh.request('DELETE /repos/{owner}/{repo}/hooks/{hook_id}', { ...base, hook_id: await idOf(c.target) })
        return 'webhook deleted'
      }
      const after = c.after as Hook & { secret_ref?: string }
      const hookConfig: Record<string, string> = { url: after.url, content_type: after.content_type, insecure_ssl: '0' }
      if (after.secret_ref) {
        const secret = await resolveSecret(after.secret_ref)
        if (!secret) throw new Error(`secret_ref ${after.secret_ref} is not set`)
        hookConfig.secret = secret
      }
      const body = { active: after.active, events: after.events, config: hookConfig }
      if (c.op === 'create') {
        await ctx.gh.request('POST /repos/{owner}/{repo}/hooks', { ...base, name: 'web', ...body })
        return 'webhook created'
      }
      await ctx.gh.request('PATCH /repos/{owner}/{repo}/hooks/{hook_id}', { ...base, hook_id: await idOf(c.target), ...body })
      return 'webhook updated'
    })
  },

  supports: notArchived,
}
