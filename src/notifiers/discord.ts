import { getSetting } from '../lib/settings'
import type { Notifier, NotifyEvent } from './types'

const COLOR: Record<NotifyEvent['kind'], number> = { drift: 0xe6b450, apply_failed: 0xf07178, apply_done: 0x7fd962 }
const TIMEOUT_MS = 10_000

export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/** Discord channel webhook from setting `notify_discord_webhook` (https only). */
export const discord: Notifier = {
  name: 'discord',
  title: 'Discord webhook',
  async enabled() {
    return isHttpsUrl(await getSetting('notify_discord_webhook'))
  },
  async send(event) {
    const url = await getSetting('notify_discord_webhook')
    if (!isHttpsUrl(url)) throw new Error('notify_discord_webhook must be an https URL')
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({
        username: 'octowarden',
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: event.title.slice(0, 256),
            description: event.text.slice(0, 4000),
            color: COLOR[event.kind],
            ...(event.url && isHttpsUrl(event.url) ? { url: event.url } : {}),
            ...(event.repo ? { footer: { text: event.repo } } : {}),
          },
        ],
      }),
    })
    if (!res.ok) throw new Error(`discord answered ${res.status}`)
  },
}
