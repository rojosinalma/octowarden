import { Kysely, sql } from 'kysely'
import { Migrator } from 'kysely/migration'
import { log, redactUrl } from '../lib/log'
import { bunSqliteDialect } from './dialects/sqlite'
import { ensureSchema, postgresDialect } from './dialects/postgres'
import { migrationProvider } from './migrations'
import { TABLES, type Database, type TableName } from './schema'

export type { Database, TableName } from './schema'
export { TABLES } from './schema'

export type Engine = 'sqlite' | 'postgres'

export interface DbHandle {
  kysely: Kysely<Database>
  engine: Engine
  /** Postgres schema holding every table; undefined for SQLite. */
  schema: string | undefined
  /** URL with credentials masked, for logs and status answers. */
  safeUrl: string
  close(): Promise<void>
}

export type OpenOptions = { poolMax?: number; migrate?: boolean }

const logger = log.child('db')
let current: DbHandle | undefined

export function engineOf(url: string): Engine {
  if (url.startsWith('sqlite:')) return 'sqlite'
  if (/^postgres(ql)?:\/\//.test(url)) return 'postgres'
  throw new Error('database URL must start with sqlite: or postgres://')
}

/** Opens a database (SQLite file or Postgres schema) and, by default, runs every pending migration. */
export async function openDb(url: string, schema: string, opts: OpenOptions = {}): Promise<DbHandle> {
  const engine = engineOf(url)
  let handle: DbHandle
  if (engine === 'sqlite') {
    const { dialect } = bunSqliteDialect(url)
    const kysely = new Kysely<Database>({ dialect })
    handle = { kysely, engine, schema: undefined, safeUrl: url, close: () => kysely.destroy() }
  } else {
    await ensureSchema(url, schema)
    const { dialect } = postgresDialect(url, schema, opts.poolMax ?? 5)
    const kysely = new Kysely<Database>({ dialect })
    handle = { kysely, engine, schema, safeUrl: redactUrl(url), close: () => kysely.destroy() }
  }
  if (opts.migrate !== false) {
    try {
      await migrate(handle)
    } catch (err) {
      await handle.close().catch(() => {})
      throw err
    }
  }
  return handle
}

/** Runs pending migrations; returns the names applied now. Throws with the failing migration's reason. */
export async function migrate(handle: DbHandle): Promise<string[]> {
  const migrator = new Migrator({
    db: handle.kysely,
    provider: migrationProvider,
    ...(handle.schema ? { migrationTableSchema: handle.schema } : {}),
  })
  const { error, results } = await migrator.migrateToLatest()
  const applied = (results ?? []).filter((r) => r.status === 'Success').map((r) => r.migrationName)
  for (const name of applied) logger.info(`migration ${name} applied`)
  const failed = results?.find((r) => r.status === 'Error')
  if (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`migration ${failed?.migrationName ?? '(unknown)'} failed: ${reason}`, { cause: error })
  }
  return applied
}

/** Opens the database and makes it the process-wide handle (closing a previous one). */
export async function connectDb(url: string, schema: string, opts: OpenOptions = {}): Promise<DbHandle> {
  const next = await openDb(url, schema, opts)
  const old = current
  current = next
  if (old) await old.close().catch(() => {})
  logger.info(`database ${next.safeUrl}${next.schema ? ` schema ${next.schema}` : ''} ready (${next.engine})`)
  return next
}

/** Process-wide query builder; throws when connectDb has not run. */
export function db(): Kysely<Database> {
  return dbHandle().kysely
}

export function dbHandle(): DbHandle {
  if (!current) throw new Error('database not connected: call connectDb() first')
  return current
}

export function dbConnected(): boolean {
  return current !== undefined
}

export async function closeDb(): Promise<void> {
  const old = current
  current = undefined
  if (old) await old.close()
}

/** `select 1` against the handle (default: process handle); false on any error or when not connected. */
export async function pingDb(handle: DbHandle | undefined = current): Promise<boolean> {
  if (!handle) return false
  try {
    await sql`select 1`.execute(handle.kysely)
    return true
  } catch {
    return false
  }
}

/** App tables present in the database (excludes Kysely's migration tables), sorted. */
export async function listTables(handle: DbHandle = dbHandle()): Promise<string[]> {
  const names =
    handle.engine === 'sqlite'
      ? (await sql<{ name: string }>`select name from sqlite_master where type = 'table'`.execute(handle.kysely)).rows
      : (
          await sql<{ name: string }>`select table_name as name from information_schema.tables
            where table_schema = ${handle.schema!} and table_type = 'BASE TABLE'`.execute(handle.kysely)
        ).rows
  return names
    .map((r) => r.name)
    .filter((n) => (TABLES as readonly string[]).includes(n))
    .sort()
}

/** Row count of one app table (adoption compares these per table). */
export async function countRows(table: TableName, handle: DbHandle = dbHandle()): Promise<number> {
  if (!(TABLES as readonly string[]).includes(table)) throw new Error(`unknown table ${table}`)
  const row = await handle.kysely
    .selectFrom(table)
    .select((eb) => eb.fn.countAll<number | string | bigint>().as('n'))
    .executeTakeFirstOrThrow()
  return Number(row.n)
}

/** `{ table: rows }` for every app table. */
export async function tableCounts(handle: DbHandle = dbHandle()): Promise<Record<string, number>> {
  const out: Record<string, number> = {}
  for (const t of TABLES) out[t] = await countRows(t, handle)
  return out
}
