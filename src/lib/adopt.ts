import { countRows, dbHandle, engineOf, openDb, TABLES, type DbHandle, type TableName } from '../db'
import { sqlitePath } from '../db/dialects/sqlite'
import { AppError, ValidationError } from './json'
import { config, removeAdoption, writeAdoption } from './config'
import { log, redactUrl } from './log'

const logger = log.child('octoforge')
const BATCH = 500
const SCHEMA_RE = /^[a-z_][a-z0-9_]{0,62}$/

/** Primary key columns per table: stable order for batched reads. */
const KEYS: Record<TableName, string[]> = {
  settings: ['key'],
  templates: ['id'],
  sets: ['id'],
  repo_sets: ['repo', 'set_name'],
  repos: ['full_name'],
  runs: ['id'],
  events: ['id'],
}

export type AdoptInput = { url: string; schema: string; copy: boolean }

function sameDatabase(a: DbHandle, url: string, schema: string): boolean {
  const cfg = config()
  if (a.engine === 'sqlite') return engineOf(url) === 'sqlite' && sqlitePath(url) === sqlitePath(cfg.databaseUrl)
  return url === cfg.databaseUrl && schema === a.schema
}

/**
 * Octoforge adoption (member contract v1 §3): open `url` (create `schema`, run migrations), copy every row
 * from the current database in batches inside one transaction on the target, compare row counts per table
 * (a difference rolls the copy back and leaves the current database in use), then write the adoption file (0600).
 * The current database is never changed. A restart switches to the new one.
 */
export async function adoptDatabase(input: AdoptInput): Promise<{ tables: Record<string, number> }> {
  let engine
  try {
    engine = engineOf(input.url)
  } catch (err) {
    throw new ValidationError((err as Error).message)
  }
  if (engine === 'postgres' && !SCHEMA_RE.test(input.schema)) throw new ValidationError(`schema must match ${SCHEMA_RE.source}`)
  if (engine === 'sqlite' && sqlitePath(input.url) === ':memory:') throw new ValidationError('an in-memory SQLite database cannot be adopted')
  const source = dbHandle()
  if (sameDatabase(source, input.url, input.schema)) throw new ValidationError('that is the database in use already')

  const safe = redactUrl(input.url)
  logger.info(`adopting ${safe}${engine === 'postgres' ? ` schema ${input.schema}` : ''} (copy ${input.copy})`)
  let target: DbHandle
  try {
    target = await openDb(input.url, input.schema, { poolMax: 2, migrate: true })
  } catch (err) {
    throw new AppError(`cannot open or migrate the target database: ${redactUrl((err as Error).message)}`, 502, 'upstream')
  }
  try {
    const tables: Record<string, number> = {}
    if (input.copy) {
      await target.kysely.transaction().execute(async (trx) => {
        // Reverse dependency order for the wipe, forward order for the copy; the target belongs to this member alone.
        for (const t of [...TABLES].reverse()) await trx.deleteFrom(t).execute()
        for (const t of TABLES) {
          let copied = 0
          for (let offset = 0; ; offset += BATCH) {
            let q = source.kysely.selectFrom(t).selectAll()
            for (const k of KEYS[t]) q = q.orderBy(k as never)
            const rows = await q.limit(BATCH).offset(offset).execute()
            if (!rows.length) break
            await trx.insertInto(t).values(rows as never).execute()
            copied += rows.length
            if (rows.length < BATCH) break
          }
          const want = await countRows(t, source)
          const got = Number(
            (await trx.selectFrom(t).select((eb) => eb.fn.countAll<number | string | bigint>().as('n')).executeTakeFirstOrThrow()).n,
          )
          if (want !== got || copied !== got) {
            throw new AppError(`row count mismatch in ${t}: source ${want}, copied ${copied}, target ${got}; adoption aborted, current database stays`, 409, 'count_mismatch', {
              table: t,
              source: want,
              target: got,
            })
          }
          tables[t] = got
        }
      })
    } else {
      for (const t of TABLES) tables[t] = await countRows(t, target)
    }
    const path = writeAdoption(config().dataDir, { url: input.url, schema: input.schema })
    logger.info(`adoption file ${path} written; restart to use ${safe}`)
    return { tables }
  } finally {
    await target.close().catch(() => {})
  }
}

/** Drops the adoption file; the next start uses DATABASE_URL again. */
export function dropAdoption(): { removed: boolean } {
  const removed = removeAdoption(config().dataDir)
  if (removed) logger.info('adoption file removed; restart to use DATABASE_URL')
  return { removed }
}
