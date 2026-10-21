import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { ADOPTION_FILE, ConfigError, loadConfig, readAdoption, removeAdoption, writeAdoption } from '../../src/lib/config'

const dirs: string[] = []
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ow-config-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('config', () => {
  test('defaults', () => {
    const d = tmp()
    const c = loadConfig({ DATA_DIR: d })
    expect(c.port).toBe(3000)
    expect(c.databaseUrl).toBe(`sqlite:${join(d, 'octowarden.db')}`)
    expect(c.databaseSchema).toBe('octowarden')
    expect(c.databaseSource).toBe('env')
    expect(c.apiToken).toBeUndefined()
    expect(c.logLevel).toBe('info')
  })

  test('env values and validation', () => {
    const c = loadConfig({ DATA_DIR: tmp(), PORT: '8080', DATABASE_URL: 'postgres://u:p@db/x', DATABASE_SCHEMA: 'ow', API_TOKEN: 't', GITHUB_APP_PRIVATE_KEY: 'a\\nb' })
    expect(c.port).toBe(8080)
    expect(c.databaseUrl).toBe('postgres://u:p@db/x')
    expect(c.databaseSchema).toBe('ow')
    expect(c.githubAppPrivateKey).toBe('a\nb')
    expect(() => loadConfig({ DATA_DIR: tmp(), PORT: 'x' })).toThrow(ConfigError)
    expect(() => loadConfig({ DATA_DIR: tmp(), DATABASE_URL: 'mysql://x' })).toThrow(/sqlite: or postgres/)
    expect(() => loadConfig({ DATA_DIR: tmp(), DATABASE_SCHEMA: 'Bad-Name' })).toThrow(/DATABASE_SCHEMA/)
    expect(() => loadConfig({ DATA_DIR: tmp(), LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/)
  })

  test('adoption file overrides DATABASE_URL and DATABASE_SCHEMA, written 0600, removable', () => {
    const d = tmp()
    const path = writeAdoption(d, { url: 'postgres://ow:pw@forge/forge', schema: 'octowarden_forge' })
    expect(statSync(path).mode & 0o777).toBe(0o600)
    const c = loadConfig({ DATA_DIR: d, DATABASE_URL: 'sqlite:./x.db', DATABASE_SCHEMA: 'other' })
    expect(c.databaseUrl).toBe('postgres://ow:pw@forge/forge')
    expect(c.databaseSchema).toBe('octowarden_forge')
    expect(c.databaseSource).toBe('octoforge')
    expect(removeAdoption(d)).toBe(true)
    expect(removeAdoption(d)).toBe(false)
    expect(loadConfig({ DATA_DIR: d, DATABASE_URL: 'sqlite:./x.db' }).databaseUrl).toBe('sqlite:./x.db')
  })

  test('broken adoption file fails fast with the path', () => {
    const d = tmp()
    writeFileSync(join(d, ADOPTION_FILE), '{"url": 1}')
    expect(() => readAdoption(d)).toThrow(/url, schema/)
    writeFileSync(join(d, ADOPTION_FILE), 'nope')
    expect(() => loadConfig({ DATA_DIR: d })).toThrow(/not valid JSON/)
  })
})
