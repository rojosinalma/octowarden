import { log } from './log'

type Hook = { name: string; fn: () => void | Promise<void> }

const hooks: Hook[] = []
const logger = log.child('http')

/** Registers a stop hook (scheduler, SSE, DB); hooks run in reverse order on SIGTERM/SIGINT. */
export function onShutdown(name: string, fn: () => void | Promise<void>): void {
  hooks.push({ name, fn })
}

/** Runs every hook once, newest first; a failing hook is logged and the rest still run. */
export async function shutdown(): Promise<void> {
  while (hooks.length) {
    const hook = hooks.pop()!
    try {
      await hook.fn()
    } catch (err) {
      logger.error(`shutdown hook ${hook.name} failed`, err instanceof Error ? err : String(err))
    }
  }
}
