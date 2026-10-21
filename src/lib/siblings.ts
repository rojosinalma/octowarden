import { z } from 'zod'
import { config } from './config'
import { getSetting, getSettingInt, setSetting } from './settings'

const MAX_MEMBERS = 50
const httpUrl = z
  .string()
  .max(2000)
  .refine((u) => /^https?:\/\//.test(u), 'an http(s) URL')
const entry = { title: z.string().min(1).max(100), url: httpUrl, icon: httpUrl.optional() }

/** Octoforge member contract v1 sibling list (`PUT /api/octoforge/siblings`). */
export const siblingsSchema = z.object({
  forge: z.object(entry),
  members: z.array(z.object({ name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/), ...entry })).max(MAX_MEMBERS),
  updated_at: z.string().max(64).optional(),
})

export type Siblings = z.infer<typeof siblingsSchema>
export type StoredSiblings = Siblings & { received_at: string }
export type SiblingView = { forge: Siblings['forge']; members: (Siblings['members'][number] & { self: boolean })[]; version?: string }

export const SELF = 'octowarden'

export async function storeSiblings(list: Siblings): Promise<void> {
  const stored: StoredSiblings = { ...list, received_at: new Date().toISOString() }
  await setSetting('octoforge_siblings', JSON.stringify(stored))
}

export async function clearSiblings(): Promise<boolean> {
  const had = (await getSetting('octoforge_siblings')) !== ''
  await setSetting('octoforge_siblings', '')
  return had
}

/**
 * What the switcher shows. Only while Octoforge is really set up: OCTOFORGE_TOKEN set and a list Octoforge re-sent
 * within `siblings_stale_min`; an old list means Octoforge is gone or stopped sending, so nothing shows. Never throws.
 */
export async function siblingView(now = Date.now()): Promise<SiblingView | undefined> {
  if (!config().octoforgeToken) return undefined
  try {
    const raw = await getSetting('octoforge_siblings')
    if (!raw) return undefined
    const stored = JSON.parse(raw) as StoredSiblings
    const parsed = siblingsSchema.safeParse(stored)
    if (!parsed.success) return undefined
    const staleMs = (await getSettingInt('siblings_stale_min')) * 60_000
    const received = Date.parse(stored.received_at)
    if (!Number.isFinite(received) || (staleMs > 0 && now - received > staleMs)) return undefined
    return { forge: parsed.data.forge, members: parsed.data.members.map((m) => ({ ...m, self: m.name === SELF })), version: parsed.data.updated_at ?? stored.received_at }
  } catch {
    return undefined
  }
}
