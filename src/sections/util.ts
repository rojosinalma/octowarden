import { isPlanLimit } from '../github/client'
import type { ApplyResult, Change } from './types'

/** ApplyResult for a change whose GitHub call threw: a plan/visibility limit is `skipped`, anything else `failed`. */
export function failed(change: Change, err: unknown): ApplyResult {
  const message = err instanceof Error ? err.message : String(err)
  return { change, outcome: isPlanLimit(err) ? 'skipped' : 'failed', message }
}

export function applied(change: Change, message: string): ApplyResult {
  return { change, outcome: 'applied', message }
}

/** Runs one GitHub write per change; one change failing never stops the others. */
export async function eachChange(changes: Change[], run: (change: Change) => Promise<string>): Promise<ApplyResult[]> {
  const out: ApplyResult[] = []
  for (const change of changes) {
    try {
      out.push(applied(change, await run(change)))
    } catch (err) {
      out.push(failed(change, err))
    }
  }
  return out
}

/** HTTP status of a GitHubError-like value (0 when unknown). */
export function statusOf(err: unknown): number {
  const s = (err as { status?: unknown })?.status
  return typeof s === 'number' ? s : 0
}

/** Comma/newline separated string or list → trimmed, non-empty strings (values are scalars, lists come as text). */
export function listOf(value: string | string[] | undefined): string[] {
  if (value === undefined) return []
  const items = Array.isArray(value) ? value : value.split(/[,\n]/)
  return items.map((s) => s.trim()).filter(Boolean)
}

/** Every section rejects archived repos the same way. */
export function notArchived(repo: { archived: boolean }): { ok: true } | { ok: false; reason: string } {
  return repo.archived ? { ok: false, reason: 'repository is archived' } : { ok: true }
}
