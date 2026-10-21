import { recordEvent } from '../lib/events'
import { ValidationError } from '../lib/json'
import { DEFAULTS, GITHUB_AUTH_MODES, isSettingKey, publicSettings, SECRET_KEYS, setSetting, type SettingKey } from '../lib/settings'
import type { Ctx } from './context'

export type PublicSettings = Record<SettingKey, string>

const LOG_LEVELS = ['debug', 'info', 'warn', 'error']
const VALUE_MAX = 16_384

/** Every setting with secrets shown as `set` or `''`. */
export async function listSettings(): Promise<PublicSettings> {
  return publicSettings()
}

/** Checks one value against the kind its default implies (integer, boolean, enum); returns a reason or undefined. */
export function settingProblem(key: SettingKey, value: string): string | undefined {
  if (value.length > VALUE_MAX) return `${key}: value too long (max ${VALUE_MAX})`
  const def: string = DEFAULTS[key]
  if (/^\d+$/.test(def) && !/^\d+$/.test(value)) return `${key}: must be a non-negative integer`
  if ((def === 'true' || def === 'false') && value !== 'true' && value !== 'false') return `${key}: must be true or false`
  if (key === 'log_level' && !LOG_LEVELS.includes(value)) return `log_level: one of ${LOG_LEVELS.join(', ')}`
  if (key === 'github_auth_mode' && !(GITHUB_AUTH_MODES as readonly string[]).includes(value)) return `github_auth_mode: one of ${GITHUB_AUTH_MODES.join(', ')}`
  if (key === 'notify_discord_webhook' && value && !/^https:\/\//.test(value)) return 'notify_discord_webhook: must be an https URL'
  if (key === 'ui_actor_header' && value && !/^[A-Za-z0-9-]{1,64}$/.test(value)) return 'ui_actor_header: a header name (letters, digits, dashes)'
  return undefined
}

/**
 * Validates every key first, then stores them. A secret sent back as `set` (the masked value) is left unchanged;
 * `''` clears it. The audit event names the keys only, never values.
 */
export async function updateSettings(patch: Record<string, string>, ctx: Ctx): Promise<PublicSettings> {
  const entries = Object.entries(patch)
  if (!entries.length) throw new ValidationError('no settings given')
  const problems: string[] = []
  const writes: [SettingKey, string][] = []
  for (const [key, raw] of entries) {
    if (!isSettingKey(key)) {
      problems.push(`unknown setting ${key}`)
      continue
    }
    if (typeof raw !== 'string') {
      problems.push(`${key}: value must be a string`)
      continue
    }
    const value = raw.trim()
    if (SECRET_KEYS.has(key) && value === 'set') continue
    const p = settingProblem(key, value)
    if (p) problems.push(p)
    else writes.push([key, value])
  }
  if (problems.length) throw new ValidationError(problems.join('; '), { problems })
  for (const [key, value] of writes) await setSetting(key, value)
  if (writes.length) {
    await recordEvent({ actor: ctx.actor, source: ctx.source, action: 'settings.update', outcome: 'info', diff: { keys: writes.map(([k]) => k) }, message: `settings changed: ${writes.map(([k]) => k).join(', ')}` })
  }
  return publicSettings()
}
