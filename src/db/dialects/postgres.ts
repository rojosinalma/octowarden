import postgres from 'postgres'
import { PostgresJSDialect } from 'kysely-postgres-js'
import { log } from '../../lib/log'

const logger = log.child('db')

/** Kysely dialect on postgres.js; every connection starts with `search_path = <schema>`. */
export function postgresDialect(url: string, schema: string, max: number): { dialect: PostgresJSDialect; sql: postgres.Sql } {
  const sql = postgres(url, {
    max,
    idle_timeout: 60,
    connect_timeout: 10,
    connection: { search_path: schema, application_name: 'octowarden' },
    onnotice: (n) => logger.debug(`notice: ${n.message}`),
  })
  return { dialect: new PostgresJSDialect({ postgres: sql }), sql }
}

/** Creates `schema` when missing, through a short-lived single connection. */
export async function ensureSchema(url: string, schema: string): Promise<void> {
  const sql = postgres(url, { max: 1, connect_timeout: 10, onnotice: () => {} })
  try {
    await sql.unsafe(`create schema if not exists "${schema.replace(/"/g, '')}"`)
  } finally {
    await sql.end({ timeout: 5 })
  }
}
