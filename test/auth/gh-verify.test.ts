import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gh, resetGhCache } from '../../src/auth/providers/gh'
import { PROVIDERS } from '../../src/auth/providers'
import { verifyCredential } from '../../src/auth/verify'
import { ValidationError } from '../../src/lib/json'
import { envOnly, restoreFetch, rsaKeys, stubGitHub } from './helpers'

const PATH = process.env.PATH
let dir: string
let empty: string

beforeAll(async () => {
  await envOnly()
  dir = mkdtempSync(join(tmpdir(), 'octowarden-gh-'))
  empty = mkdtempSync(join(tmpdir(), 'octowarden-nogh-'))
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\n[ "$1 $2" = "auth token" ] && echo gho_testclitoken && exit 0\nexit 1\n')
  chmodSync(join(dir, 'gh'), 0o755)
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
  rmSync(empty, { recursive: true, force: true })
})

afterEach(() => {
  process.env.PATH = PATH
  resetGhCache()
  restoreFetch()
})

describe('gh CLI provider', () => {
  test('registered; unavailable when gh is not on PATH', async () => {
    expect(PROVIDERS.gh).toBe(gh)
    expect(PROVIDERS.app?.name).toBe('app')
    process.env.PATH = empty
    expect(await gh.available()).toBe(false)
    expect(await gh.source()).toBe('none')
  })

  test('token from `gh auth token`; identity via GET /user with that token', async () => {
    process.env.PATH = `${dir}:${PATH}`
    expect(await gh.available()).toBe(true)
    expect(await gh.source()).toBe('gh-cli')
    const seen = stubGitHub({ 'GET /user': { login: 'octo-example' } })
    expect(await gh.identity()).toEqual({ login: 'octo-example' })
    expect(seen[0]!.authorization).toBe('token gho_testclitoken')
    expect((await gh.client()).mode).toBe('gh')
  })
})

describe('verifyCredential', () => {
  test('pat: login on success, ValidationError with GitHub reason on failure', async () => {
    stubGitHub({ 'GET /user': (r) => (r.authorization === 'token good' ? { body: { login: 'octo-example' } } : { status: 401, body: { message: 'Bad credentials' } }) })
    expect(await verifyCredential({ mode: 'pat', token: 'good' })).toEqual({ login: 'octo-example' })
    const err = await verifyCredential({ mode: 'pat', token: 'bad' }).catch((e) => e)
    expect(err).toBeInstanceOf(ValidationError)
    expect(err.message).toBe('GitHub rejected the token: Bad credentials (HTTP 401)')
    expect(err.message).not.toContain('bad ')
    await expect(verifyCredential({ mode: 'pat', token: ' ' })).rejects.toThrow('token is empty')
  })

  test('app: slug via JWT, installation checked when given; bad inputs rejected before any call', async () => {
    const { privateKey } = rsaKeys()
    const seen = stubGitHub({ 'GET /app': { slug: 'octowarden-test' }, 'GET /app/installations/777': { id: 777 } })
    expect(await verifyCredential({ mode: 'app', app_id: 12345, private_key: privateKey.replace(/\n/g, '\\n'), installation_id: '777' })).toEqual({ app_slug: 'octowarden-test' })
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['GET /app', 'GET /app/installations/777'])
    const missing = await verifyCredential({ mode: 'app', app_id: '12345', private_key: privateKey, installation_id: 999 }).catch((e) => e)
    expect(missing).toBeInstanceOf(ValidationError)
    expect(missing.message).toMatch(/^GitHub rejected the App credentials: .*HTTP 404/)
    await expect(verifyCredential({ mode: 'app', app_id: 'abc', private_key: privateKey })).rejects.toThrow('app_id must be a number')
    await expect(verifyCredential({ mode: 'app', app_id: '1', private_key: 'nope' })).rejects.toThrow('private_key must be a PEM private key')
  })
})
