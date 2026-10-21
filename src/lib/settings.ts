import { db, dbConnected } from '../db'
import { nowIso } from '../db/util'
import { bus } from './bus'
import { setLogLevel } from './log'

/** Every tunable with its default (values are strings, as stored). The one place defaults live. */
export const DEFAULTS = {
  log_level: 'info',
  ui_skin: 'luz',
  ui_palette: 'ayu',
  ui_mode: 'dark',
  audit_interval_min: '360',
  audit_jitter_s: '120',
  audit_retention_days: '30',
  github_concurrency: '4',
  sse_max_clients: '20',
  sse_idle_s: '300',
  /** auto = delivered/settings App → pat → gh; or force one provider. */
  github_auth_mode: 'auto',
  github_token: '',
  github_app_id: '',
  github_app_private_key: '',
  github_app_installation_id: '',
  github_webhook_secret: '',
  /** `octoforge` when the GitHub credential above was delivered via PUT /api/octoforge/github, else empty. */
  github_credential_source: '',
  notify_discord_webhook: '',
  notify_on_drift: 'true',
  notify_on_apply_fail: 'true',
  default_owner: '',
  /** Request header (set by the reverse proxy) that names the UI user in the audit trail; empty or absent → `ui`. */
  ui_actor_header: 'remote-user',
  /** Max repos fetched from GitHub per repo list refresh. */
  repos_refresh_max: '1000',
  /** Max repos in one bulk plan/apply/audit call. */
  bulk_max_repos: '500',
  /** Applied plans are dropped; unapplied plans expire after this many minutes (in memory, max 200). */
  plan_ttl_min: '30',
  /** MCP sessions kept in memory; the least recently used goes when full. */
  mcp_max_sessions: '64',
  /** MCP sessions idle longer than this are closed (clients re-initialise). */
  mcp_session_idle_min: '30',
  /** The scheduler skips an audit while GitHub's core rate limit left is below this. */
  audit_min_rate_remaining: '500',
  /** bin/backup target directory for SQLite snapshots; empty = <DATA_DIR>/backups. */
  backup_dir: '',
  /** bin/backup keeps this many newest snapshots. */
  backup_keep: '14',
} as const satisfies Record<string, string>

export type SettingKey = keyof typeof DEFAULTS

/** Keys whose values never leave the instance: UI/API/export show them as set/unset only. */
export const SECRET_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  'github_token',
  'github_app_private_key',
  'github_webhook_secret',
  'notify_discord_webhook',
])

export const GITHUB_AUTH_MODES = ['auto', 'pat', 'gh', 'app'] as const

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(DEFAULTS, key)
}

const TTL_MS = 5_000
let cache: { values: Map<string, string>; at: number } | undefined
let loading: Promise<Map<string, string>> | undefined

async function load(): Promise<Map<string, string>> {
  if (!dbConnected()) return new Map()
  if (cache && Date.now() - cache.at < TTL_MS) return cache.values
  loading ??= (async () => {
    try {
      const rows = await db().selectFrom('settings').select(['key', 'value']).execute()
      const values = new Map(rows.map((r) => [r.key, r.value]))
      cache = { values, at: Date.now() }
      setLogLevel(values.get('log_level') ?? DEFAULTS.log_level)
      return values
    } finally {
      loading = undefined
    }
  })()
  return loading
}

/** Current value (DB, cached ≤ 5 s, else the default). Read at use time; never capture it at import. */
export async function getSetting(key: SettingKey): Promise<string> {
  return (await load()).get(key) ?? DEFAULTS[key]
}

/** Integer setting; the default when the stored value is not a non-negative integer. */
export async function getSettingInt(key: SettingKey): Promise<number> {
  const n = Number(await getSetting(key))
  return Number.isInteger(n) && n >= 0 ? n : Number(DEFAULTS[key])
}

export async function getSettingBool(key: SettingKey): Promise<boolean> {
  return (await getSetting(key)) === 'true'
}

/** Upserts one setting, drops the cache and publishes `settings` on the bus (key only, never the value). */
export async function setSetting(key: SettingKey, value: string): Promise<void> {
  const now = nowIso()
  await db()
    .insertInto('settings')
    .values({ key, value, updated_at: now })
    .onConflict((oc) => oc.column('key').doUpdateSet({ value, updated_at: now }))
    .execute()
  cache = undefined
  if (key === 'log_level') setLogLevel(value)
  bus.publish('settings', { key })
}

/** Resets a key to its default value. */
export async function resetSetting(key: SettingKey): Promise<void> {
  await setSetting(key, DEFAULTS[key])
}

/** Defaults overlaid with stored rows (secrets included — callers redact with `publicSettings`). */
export async function allSettings(): Promise<Record<SettingKey, string>> {
  const values = await load()
  const out = { ...DEFAULTS } as Record<SettingKey, string>
  for (const key of Object.keys(DEFAULTS) as SettingKey[]) {
    const v = values.get(key)
    if (v !== undefined) out[key] = v
  }
  return out
}

/** allSettings with every secret replaced by `'set'` or `''`. Safe for UI, API, exports. */
export async function publicSettings(): Promise<Record<SettingKey, string>> {
  const all = await allSettings()
  for (const key of SECRET_KEYS) all[key] = all[key] ? 'set' : ''
  return all
}

/** Inserts every missing default; existing values stay. Runs on boot after migrations. */
export async function seedSettings(): Promise<void> {
  const now = nowIso()
  await db()
    .insertInto('settings')
    .values(Object.entries(DEFAULTS).map(([key, value]) => ({ key, value, updated_at: now })))
    .onConflict((oc) => oc.column('key').doNothing())
    .execute()
  cache = undefined
  await load()
}

/** Drops the cache (tests, DB switch). */
export function resetSettingsCache(): void {
  cache = undefined
}
