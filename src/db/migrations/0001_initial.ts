import type { Kysely } from 'kysely'

// Additive only: never alter or drop a column here; later changes are new migration files.
export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('settings')
    .ifNotExists()
    .addColumn('key', 'text', (c) => c.primaryKey())
    .addColumn('value', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'text', (c) => c.notNull())
    .execute()

  await db.schema
    .createTable('templates')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('sections', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('requires', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'text', (c) => c.notNull())
    .execute()

  await db.schema
    .createTable('sets')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('name', 'text', (c) => c.notNull().unique())
    .addColumn('description', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('template_names', 'text', (c) => c.notNull().defaultTo('[]'))
    .addColumn('values', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addColumn('updated_at', 'text', (c) => c.notNull())
    .execute()

  await db.schema
    .createTable('repo_sets')
    .ifNotExists()
    .addColumn('repo', 'text', (c) => c.notNull())
    .addColumn('set_name', 'text', (c) => c.notNull())
    .addColumn('values', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('position', 'integer', (c) => c.notNull().defaultTo(0))
    .addColumn('created_at', 'text', (c) => c.notNull())
    .addPrimaryKeyConstraint('repo_sets_pk', ['repo', 'set_name'])
    .execute()

  await db.schema
    .createTable('repos')
    .ifNotExists()
    .addColumn('full_name', 'text', (c) => c.primaryKey())
    .addColumn('metadata', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('last_audit_at', 'text')
    .addColumn('drift_state', 'text', (c) => c.notNull().defaultTo('unknown'))
    .addColumn('drift_summary', 'text', (c) => c.notNull().defaultTo('{}'))
    .addColumn('updated_at', 'text', (c) => c.notNull())
    .execute()

  await db.schema
    .createTable('runs')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('kind', 'text', (c) => c.notNull())
    .addColumn('source', 'text', (c) => c.notNull())
    .addColumn('actor', 'text', (c) => c.notNull())
    .addColumn('status', 'text', (c) => c.notNull())
    .addColumn('started_at', 'text', (c) => c.notNull())
    .addColumn('finished_at', 'text')
    .addColumn('summary', 'text', (c) => c.notNull().defaultTo('{}'))
    .execute()
  await db.schema.createIndex('runs_started_at_idx').ifNotExists().on('runs').column('started_at').execute()

  await db.schema
    .createTable('events')
    .ifNotExists()
    .addColumn('id', 'text', (c) => c.primaryKey())
    .addColumn('at', 'text', (c) => c.notNull())
    .addColumn('actor', 'text', (c) => c.notNull())
    .addColumn('source', 'text', (c) => c.notNull())
    .addColumn('repo', 'text')
    .addColumn('section', 'text')
    .addColumn('action', 'text', (c) => c.notNull())
    .addColumn('outcome', 'text', (c) => c.notNull())
    .addColumn('diff', 'text')
    .addColumn('message', 'text', (c) => c.notNull().defaultTo(''))
    .addColumn('run_id', 'text')
    .execute()
  await db.schema.createIndex('events_at_idx').ifNotExists().on('events').column('at').execute()
  await db.schema.createIndex('events_repo_idx').ifNotExists().on('events').columns(['repo', 'at']).execute()
  await db.schema.createIndex('events_run_idx').ifNotExists().on('events').column('run_id').execute()
}

export async function down(): Promise<void> {
  throw new Error('migrations are additive only; no down migration')
}
