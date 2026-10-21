import { log } from '../lib/log'
import { getSettingBool } from '../lib/settings'
import { discord } from './discord'
import type { Notifier, NotifyEvent } from './types'

/** One line per notifier. */
export const NOTIFIERS: Record<string, Notifier> = {
  discord,
}

const logger = log.child('notify')

export function getNotifier(name: string): Notifier | undefined {
  return NOTIFIERS[name]
}

export function listNotifiers(): Notifier[] {
  return Object.values(NOTIFIERS)
}

/** Sends to every enabled notifier, honouring notify_on_drift / notify_on_apply_fail. Never throws. */
export async function notify(event: NotifyEvent): Promise<{ sent: string[]; failed: string[] }> {
  const out = { sent: [] as string[], failed: [] as string[] }
  try {
    if (event.kind === 'drift' && !(await getSettingBool('notify_on_drift'))) return out
    if (event.kind === 'apply_failed' && !(await getSettingBool('notify_on_apply_fail'))) return out
  } catch (err) {
    logger.error('notify settings unreadable', err instanceof Error ? err : String(err))
    return out
  }
  for (const n of listNotifiers()) {
    try {
      if (!(await n.enabled())) continue
      await n.send(event)
      out.sent.push(n.name)
      logger.info(`${n.name}: sent ${event.kind}${event.repo ? ` for ${event.repo}` : ''}`)
    } catch (err) {
      out.failed.push(n.name)
      logger.error(`${n.name}: send ${event.kind} failed`, err instanceof Error ? err : String(err))
    }
  }
  return out
}
