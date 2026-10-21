import type { Source } from '../db/schema'
import { AppError } from '../lib/json'
import { getSetting } from '../lib/settings'

/** Who asks: the interface (`source`) and a readable name for the audit trail (`actor`). */
export type Ctx = { source: Source; actor: string }

const ACTOR_MAX = 100

/** Throws 409 `confirm_required` unless `confirm` repeats `expected` exactly (typed confirm of a name). */
export function requireConfirm(expected: string, confirm: string | undefined, what: string): void {
  if (confirm === expected) return
  throw new AppError(`${what}: confirm with the exact name "${expected}"`, 409, 'confirm_required', { expected })
}

/**
 * UI actor: the value of the request header named by `ui_actor_header` (the reverse proxy sets it),
 * else `ui`. Trimmed and capped; never trusted for anything but the audit trail.
 */
export async function uiActor(headers: Headers): Promise<string> {
  const name = (await getSetting('ui_actor_header')).trim()
  const value = name ? headers.get(name)?.trim() : undefined
  return value ? value.slice(0, ACTOR_MAX) : 'ui'
}

/** Ctx for a UI request. */
export async function uiCtx(headers: Headers): Promise<Ctx> {
  return { source: 'ui', actor: await uiActor(headers) }
}

export const API_CTX: Ctx = { source: 'api', actor: 'api' }
export const MCP_CTX: Ctx = { source: 'mcp', actor: 'mcp' }
export const SCHEDULER_CTX: Ctx = { source: 'scheduler', actor: 'scheduler' }
