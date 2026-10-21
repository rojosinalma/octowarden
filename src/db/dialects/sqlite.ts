import { Database } from 'bun:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SqliteDialect, type SqliteDatabase, type SqliteStatement } from 'kysely'

type Bind = string | number | bigint | boolean | null | Uint8Array

/** `sqlite:./data/x.db` → `./data/x.db`; `sqlite::memory:` → `:memory:`. */
export function sqlitePath(url: string): string {
  const rest = url.replace(/^sqlite:(\/\/)?/, '')
  return rest === '' ? ':memory:' : rest
}

/** Adapts bun:sqlite to Kysely's SqliteDatabase (positional arrays → spread bindings). */
function adapt(db: Database): SqliteDatabase {
  return {
    close: () => db.close(),
    prepare(sql: string): SqliteStatement {
      const stmt = db.prepare(sql)
      return {
        reader: stmt.columnNames.length > 0,
        all: (params) => stmt.all(...(params as Bind[])),
        run: (params) => stmt.run(...(params as Bind[])),
        iterate: (params) => stmt.iterate(...(params as Bind[])),
      }
    },
  }
}

/** Kysely dialect on bun:sqlite with WAL, foreign keys and a busy timeout. */
export function bunSqliteDialect(url: string): { dialect: SqliteDialect; path: string } {
  const path = sqlitePath(url)
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const raw = new Database(path, { create: true, strict: true })
  raw.exec('pragma journal_mode = wal')
  raw.exec('pragma foreign_keys = on')
  raw.exec('pragma busy_timeout = 5000')
  return { dialect: new SqliteDialect({ database: adapt(raw) }), path }
}
