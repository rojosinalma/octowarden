import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'
export type DatabaseSource = 'env' | 'octoforge'

/** Bootstrap configuration only; every tunable lives in the settings table. */
export type Config = {
  port: number
  dataDir: string
  databaseUrl: string
  databaseSchema: string
  /** `octoforge` when DATA_DIR/octoforge-database.json overrides DATABASE_URL/DATABASE_SCHEMA. */
  databaseSource: DatabaseSource
  databasePoolMax: number
  apiToken: string | undefined
  octoforgeToken: string | undefined
  logLevel: LogLevel
  githubToken: string | undefined
  githubAppId: string | undefined
  githubAppPrivateKey: string | undefined
  githubAppInstallationId: string | undefined
  githubWebhookSecret: string | undefined
}

export class ConfigError extends Error {}

export const ADOPTION_FILE = 'octoforge-database.json'

const adoptionSchema = z.object({ url: z.string().min(1), schema: z.string().min(1) })
export type Adoption = z.infer<typeof adoptionSchema>

const LEVELS: readonly LogLevel[] = ['debug', 'info', 'warn', 'error']
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/

function intOf(name: string, value: string | undefined, fallback: number): number {
  if (value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isInteger(n) || n <= 0) throw new ConfigError(`${name} must be a positive integer, got "${value}"`)
  return n
}

function opt(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value
}

/** Private keys arrive from .env with literal "\n"; restore real newlines. */
export function pem(value: string | undefined): string | undefined {
  return value ? value.replace(/\\n/g, '\n') : undefined
}

export function adoptionPath(dataDir: string): string {
  return join(dataDir, ADOPTION_FILE)
}

/** Reads DATA_DIR/octoforge-database.json; undefined when absent. Throws ConfigError when it is unreadable. */
export function readAdoption(dataDir: string): Adoption | undefined {
  const path = adoptionPath(dataDir)
  if (!existsSync(path)) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    throw new ConfigError(`${path} is not valid JSON: ${(err as Error).message}`)
  }
  const parsed = adoptionSchema.safeParse(raw)
  if (!parsed.success) throw new ConfigError(`${path} needs {url, schema}: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  return parsed.data
}

/** Writes the adoption file with mode 0600 (contract §3). */
export function writeAdoption(dataDir: string, adoption: Adoption): string {
  const value = adoptionSchema.parse(adoption)
  mkdirSync(dataDir, { recursive: true })
  const path = adoptionPath(dataDir)
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 })
  chmodSync(path, 0o600)
  return path
}

/** Removes the adoption file; the next start uses DATABASE_URL again. Returns whether a file was removed. */
export function removeAdoption(dataDir: string): boolean {
  const path = adoptionPath(dataDir)
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

/** Builds and validates a config from an env map; reads the adoption file in DATA_DIR. Throws ConfigError. */
export function loadConfig(env: Record<string, string | undefined> = Bun.env): Config {
  const dataDir = opt(env.DATA_DIR) ?? './data'
  const logLevel = (opt(env.LOG_LEVEL) ?? 'info') as LogLevel
  if (!LEVELS.includes(logLevel)) throw new ConfigError(`LOG_LEVEL must be one of ${LEVELS.join(', ')}, got "${env.LOG_LEVEL}"`)

  const adoption = readAdoption(dataDir)
  const databaseUrl = adoption?.url ?? opt(env.DATABASE_URL) ?? `sqlite:${join(dataDir, 'octowarden.db')}`
  const databaseSchema = adoption?.schema ?? opt(env.DATABASE_SCHEMA) ?? 'octowarden'
  if (!/^(sqlite:|postgres(ql)?:\/\/)/.test(databaseUrl)) {
    throw new ConfigError('DATABASE_URL must start with sqlite: or postgres://')
  }
  if (!SCHEMA_RE.test(databaseSchema)) {
    throw new ConfigError(`DATABASE_SCHEMA must match ${SCHEMA_RE.source}, got "${databaseSchema}"`)
  }

  return {
    port: intOf('PORT', env.PORT, 3000),
    dataDir,
    databaseUrl,
    databaseSchema,
    databaseSource: adoption ? 'octoforge' : 'env',
    databasePoolMax: intOf('DATABASE_POOL_MAX', env.DATABASE_POOL_MAX, 5),
    apiToken: opt(env.API_TOKEN),
    octoforgeToken: opt(env.OCTOFORGE_TOKEN),
    logLevel,
    githubToken: opt(env.GITHUB_TOKEN),
    githubAppId: opt(env.GITHUB_APP_ID),
    githubAppPrivateKey: pem(opt(env.GITHUB_APP_PRIVATE_KEY)),
    githubAppInstallationId: opt(env.GITHUB_APP_INSTALLATION_ID),
    githubWebhookSecret: opt(env.GITHUB_WEBHOOK_SECRET),
  }
}

let current: Config | undefined

/** Process-wide config, read from Bun.env on first use. */
export function config(): Config {
  current ??= loadConfig()
  return current
}

/** Replaces the cached config (tests, CLI). */
export function setConfig(next: Config | undefined): void {
  current = next
}
