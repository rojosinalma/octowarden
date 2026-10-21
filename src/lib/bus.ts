import { log } from './log'

/** Topics and their payloads. Add a topic here before publishing it. */
export type BusTopics = {
  /** A setting changed (key only, never the value). */
  settings: { key: string }
  /** An audit event was recorded. */
  event: { id: string; repo: string | null; section: string | null; outcome: string; action: string; run_id: string | null }
  /** A run started, progressed or finished; `repo`/`done`/`total` drive per-repo progress over SSE. */
  run: {
    id: string
    kind: string
    status: string
    repo?: string
    done?: number
    total?: number
    message?: string
    /** Bulk/audit progress (services): same as `id`, per-repo `summary`, final `totals`. */
    run_id?: string
    summary?: string
    totals?: Record<string, number>
  }
  /** A repo's drift state changed. */
  drift: { repo: string; state: string }
}
export type Topic = keyof BusTopics
export type Handler<T extends Topic> = (payload: BusTopics[T]) => void

const logger = log.child('bus')

/** In-process pub/sub with a cap per topic; `subscribe` returns the unsubscribe function, or undefined when full. */
export function createBus(maxPerTopic = 200) {
  const subs = new Map<Topic, Set<Handler<any>>>()
  return {
    subscribe<T extends Topic>(topic: T, handler: Handler<T>): (() => void) | undefined {
      let set = subs.get(topic)
      if (!set) subs.set(topic, (set = new Set()))
      if (set.size >= maxPerTopic) {
        logger.warn(`subscriber limit ${maxPerTopic} reached on ${topic}`)
        return undefined
      }
      set.add(handler)
      return () => void set.delete(handler)
    },
    publish<T extends Topic>(topic: T, payload: BusTopics[T]): void {
      for (const h of subs.get(topic) ?? []) {
        try {
          h(payload)
        } catch (err) {
          logger.error(`subscriber on ${topic} failed`, err instanceof Error ? err : String(err))
        }
      }
    },
    count(topic?: Topic): number {
      if (topic) return subs.get(topic)?.size ?? 0
      let n = 0
      for (const s of subs.values()) n += s.size
      return n
    },
    clear(): void {
      subs.clear()
    },
  }
}

export type Bus = ReturnType<typeof createBus>

/** Process-wide bus. SSE limits its own clients with `sse_max_clients`. */
export const bus: Bus = createBus()
