import { connectDb, type DbHandle } from '../db'
import { config, type Config } from './config'
import { seedSettings } from './settings'

/** Opens the configured database, runs migrations and seeds settings defaults. Shared by server, CLI and tests. */
export async function boot(cfg: Config = config()): Promise<DbHandle> {
  const handle = await connectDb(cfg.databaseUrl, cfg.databaseSchema, { poolMax: cfg.databasePoolMax })
  await seedSettings()
  return handle
}
