import { AppError } from './json'

export interface Semaphore {
  run<T>(fn: () => Promise<T>): Promise<T>
  active(): number
  waiting(): number
}

/**
 * Bounded concurrency; `limit` is read on every acquire so a setting change applies at once.
 * The wait queue is capped: past `maxQueue` waiters `run` rejects with a 503 instead of growing.
 */
export function createSemaphore(limit: () => number, maxQueue = 1000): Semaphore {
  let running = 0
  const queue: Array<() => void> = []

  const next = () => {
    while (queue.length && running < Math.max(1, limit())) {
      running++
      queue.shift()!()
    }
  }

  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      if (running >= Math.max(1, limit())) {
        if (queue.length >= maxQueue) throw new AppError('too many queued GitHub calls', 503, 'unavailable')
        await new Promise<void>((resolve) => queue.push(resolve))
      } else running++
      try {
        return await fn()
      } finally {
        running--
        next()
      }
    },
    active: () => running,
    waiting: () => queue.length,
  }
}
