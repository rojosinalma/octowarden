import type { AnyElysia } from 'elysia'
import { z } from 'zod'
import { ValidationError } from '../../lib/json'
import { API_CTX, type Ctx } from '../../services'

/** Every /api call acts as `api` in the audit trail. */
export const ctx: Ctx = API_CTX

/** One resource module: adds its routes to the guarded `/api` group. */
export type RouteModule = (app: AnyElysia) => unknown

export const confirmBody = z.object({ confirm: z.string().max(300).optional() }).loose()

/** Body or `{}` (DELETE without a body). */
export function bodyOf(body: unknown): Record<string, unknown> {
  if (body === undefined || body === null || body === '') return {}
  if (typeof body !== 'object' || Array.isArray(body)) throw new ValidationError('body must be a JSON object')
  return body as Record<string, unknown>
}

/** `?x=a,b` → ['a', 'b']; undefined when absent. */
export function listParam(v: unknown): string[] | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined
  return v.split(',').map((s) => s.trim()).filter(Boolean)
}

/** `1`, `true`, `yes` → true. */
export function flagParam(v: unknown): boolean {
  return typeof v === 'string' && /^(1|true|yes)$/i.test(v)
}
