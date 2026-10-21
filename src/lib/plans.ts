import type { Plan } from '../engine/types'

export type StoredPlan = { plan: Plan; at: number }

export const PLANS_MAX = 200
export const PLAN_TTL_MS = 30 * 60_000

/**
 * In-memory LRU of plans waiting for apply: at most `max` entries, each dropped `ttlMs` after it was made.
 * `ttlMs` may be a getter so a setting change applies at once. Never grows past `max`.
 */
export function createPlanCache(max = PLANS_MAX, ttlMs: number | (() => number) = PLAN_TTL_MS) {
  const plans = new Map<string, StoredPlan>()
  const ttl = () => (typeof ttlMs === 'function' ? ttlMs() : ttlMs)

  const prune = (now = Date.now()) => {
    for (const [id, p] of plans) if (now - p.at > ttl()) plans.delete(id)
  }

  return {
    put(id: string, plan: Plan, now = Date.now()): void {
      prune(now)
      plans.delete(id)
      plans.set(id, { plan, at: now })
      while (plans.size > max) plans.delete(plans.keys().next().value!)
    },
    get(id: string, now = Date.now()): Plan | undefined {
      const p = plans.get(id)
      if (!p) return undefined
      if (now - p.at > ttl()) {
        plans.delete(id)
        return undefined
      }
      // Recently used moves to the end (LRU order); its expiry stays tied to creation.
      plans.delete(id)
      plans.set(id, p)
      return p.plan
    },
    delete(id: string): boolean {
      return plans.delete(id)
    },
    size(): number {
      prune()
      return plans.size
    },
    clear(): void {
      plans.clear()
    },
  }
}

export type PlanCache = ReturnType<typeof createPlanCache>
