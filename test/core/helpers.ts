// Shared test bootstrap: SQLite in memory, fake GitHub. Import first in every core test.
import { setGitHubClient } from '../../src/auth/providers'
import { closeDb, type DbHandle } from '../../src/db'
import { createFakeGitHub, type FakeGitHub } from '../../src/github/fake'
import { boot } from '../../src/lib/boot'
import { bus } from '../../src/lib/bus'
import { loadConfig, setConfig, type Config } from '../../src/lib/config'
import { setLogLevel } from '../../src/lib/log'
import { resetSettingsCache, setSetting } from '../../src/lib/settings'
import repoFixture from '../fixtures/repo.json'

export const TEST_ENV: Record<string, string> = {
  DATA_DIR: '/nonexistent-octowarden-test',
  DATABASE_URL: 'sqlite::memory:',
  API_TOKEN: 'test-api-token',
  LOG_LEVEL: 'error',
}

export type World = { db: DbHandle; config: Config; github: FakeGitHub }

/** Fresh in-memory DB (migrated + seeded) and a fake GitHub serving the recorded repo fixture. */
export async function fresh(env: Record<string, string> = {}): Promise<World> {
  await closeDb()
  resetSettingsCache()
  bus.clear()
  setLogLevel('error')
  const config = loadConfig({ ...TEST_ENV, ...env })
  setConfig(config)
  const db = await boot(config)
  await setSetting('log_level', Bun.env.TEST_LOG_LEVEL ?? 'error')
  const github = createFakeGitHub()
  serveRepo(github)
  setGitHubClient(github)
  return { db, config, github }
}

/** GET/PATCH /repos/{owner}/{repo} over a mutable copy of the fixture. */
export function serveRepo(github: FakeGitHub, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const repo: Record<string, unknown> = { ...structuredClone(repoFixture), ...overrides }
  github.on('GET /repos/{owner}/{repo}', () => repo)
  github.on('PATCH /repos/{owner}/{repo}', (params) => {
    const { owner: _o, repo: _r, ...body } = params
    Object.assign(repo, body)
    return repo
  })
  return repo
}

export const REPO = repoFixture.full_name
