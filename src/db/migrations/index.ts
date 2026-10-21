import type { Migration, MigrationProvider } from 'kysely/migration'
import * as m0001 from './0001_initial'

/**
 * Every migration, in order. Static imports (no folder scan) so the bundled CLI carries them.
 * Add a file `NNNN_name.ts` and one line here; never edit or reorder a shipped entry.
 */
export const MIGRATIONS: Record<string, Migration> = {
  '0001_initial': m0001,
}

export const migrationProvider: MigrationProvider = {
  getMigrations: async () => MIGRATIONS,
}
