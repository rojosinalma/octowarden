import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import postgres from 'postgres'
import { countRows, listTables, migrate, openDb, pingDb, tableCounts, TABLES, type DbHandle } from '../../src/db'
import { setLogLevel } from '../../src/lib/log'

setLogLevel(Bun.env.TEST_LOG_LEVEL ?? 'error')

async function exercise(h: DbHandle): Promise<void> {
  expect(await pingDb(h)).toBe(true)
  expect(await listTables(h)).toEqual([...TABLES].sort())
  expect(await migrate(h)).toEqual([])
  const now = new Date().toISOString()
  await h.kysely.insertInto('settings').values({ key: 'k', value: 'v', updated_at: now }).execute()
  await h.kysely
    .insertInto('templates')
    .values({ id: 't1', name: 'base', description: '', sections: '{"settings":{}}', requires: '{}', created_at: now, updated_at: now })
    .execute()
  await h.kysely.insertInto('repo_sets').values({ repo: 'o/r', set_name: 's', values: '{}', created_at: now }).execute()
  await h.kysely
    .insertInto('events')
    .values({ id: 'e1', at: now, actor: 'a', source: 'api', repo: 'o/r', section: null, action: 'plan', outcome: 'planned', diff: null, message: '', run_id: null })
    .execute()
  expect(await countRows('settings', h)).toBe(1)
  expect(await tableCounts(h)).toEqual({ settings: 1, templates: 1, sets: 0, repo_sets: 1, repos: 0, runs: 0, events: 1 })
  const rs = await h.kysely.selectFrom('repo_sets').selectAll().executeTakeFirstOrThrow()
  expect(rs.position).toBe(0)
  expect(h.kysely.insertInto('templates').values({ id: 't2', name: 'base', description: '', sections: '{}', requires: '{}', created_at: now, updated_at: now }).execute()).rejects.toThrow()
}

describe('migrations on SQLite', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ow-db-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('in memory', async () => {
    const h = await openDb('sqlite::memory:', 'ignored')
    expect(h.engine).toBe('sqlite')
    await exercise(h)
    await h.close()
  })

  test('file: reopen keeps data and applies nothing new', async () => {
    const url = `sqlite:${join(dir, 'sub', 'ow.db')}`
    const a = await openDb(url, 'ignored')
    await exercise(a)
    await a.close()
    const b = await openDb(url, 'ignored')
    expect(await migrate(b)).toEqual([])
    expect(await countRows('templates', b)).toBe(1)
    await b.close()
  })

  test('pingDb is false for a closed handle', async () => {
    const h = await openDb('sqlite::memory:', 'x')
    await h.close()
    expect(await pingDb(h)).toBe(false)
  })
})

const PG = Bun.env.TEST_POSTGRES_URL

describe.skipIf(!PG)('migrations on Postgres (TEST_POSTGRES_URL)', () => {
  const schema = `ow_test_${Date.now().toString(36)}`
  afterAll(async () => {
    const sql = postgres(PG!, { max: 1, onnotice: () => {} })
    await sql.unsafe(`drop schema if exists "${schema}" cascade`)
    await sql.end()
  })

  test('creates the schema and keeps every table inside it', async () => {
    const h = await openDb(PG!, schema)
    expect(h.engine).toBe('postgres')
    expect(h.schema).toBe(schema)
    expect(h.safeUrl).not.toContain(':x@')
    await exercise(h)
    await h.close()

    const sql = postgres(PG!, { max: 1, onnotice: () => {} })
    const rows = await sql<{ table_name: string }[]>`select table_name from information_schema.tables where table_schema = ${schema} order by 1`
    await sql.end()
    const names = rows.map((r) => r.table_name)
    for (const t of TABLES) expect(names).toContain(t)
    expect(names).toContain('kysely_migration')
  })

  test('reopen is idempotent', async () => {
    const h = await openDb(PG!, schema)
    expect(await migrate(h)).toEqual([])
    expect(await countRows('events', h)).toBe(1)
    await h.close()
  })
})
