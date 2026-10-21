import { afterEach, describe, expect, test } from 'bun:test'
import { createVerify } from 'node:crypto'
import { app, ownerOf, resetAppCache } from '../../src/auth/providers/app'
import { boot } from '../../src/lib/boot'
import { closeDb } from '../../src/db'
import { loadConfig, setConfig } from '../../src/lib/config'
import { resetSettingsCache, setSetting } from '../../src/lib/settings'
import repoFixture from '../fixtures/repo.json'
import { decodeJwt, envOnly, restoreFetch, rsaKeys, stubGitHub } from './helpers'

const future = () => new Date(Date.now() + 3600_000).toISOString()

function routes(installation = 777) {
  return {
    'GET /app': { id: 12345, slug: 'octowarden-test', name: 'octowarden test' },
    'GET /repos/octo-example/demo/installation': { id: installation, account: { login: 'octo-example' } },
    'GET /users/octo-example/installation': { id: installation, account: { login: 'octo-example' } },
    'GET /app/installations': [{ id: installation }],
    [`POST /app/installations/${installation}/access_tokens`]: { status: 201, body: { token: 'ghs_testinstallationtoken', expires_at: future(), permissions: {}, repository_selection: 'all' } },
    'GET /repos/octo-example/demo': repoFixture,
  }
}

afterEach(async () => {
  restoreFetch()
  resetAppCache()
  await closeDb()
})

describe('GitHub App provider', () => {
  test('unavailable without id + key', async () => {
    await envOnly()
    expect(await app.available()).toBe(false)
    expect(await app.source()).toBe('none')
    expect(await app.identity()).toEqual({})
  })

  test('identity: GET /app signed with an RS256 JWT (iss = app id) from the env key', async () => {
    const { privateKey, publicKey } = rsaKeys()
    await envOnly({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKey.replace(/\n/g, '\\n') })
    const seen = stubGitHub(routes())
    expect(await app.available()).toBe(true)
    expect(await app.source()).toBe('env')
    expect(await app.identity()).toEqual({ app_slug: 'octowarden-test' })
    const [call] = seen
    expect(call).toMatchObject({ method: 'GET', path: '/app' })
    expect(call!.authorization).toMatch(/^bearer /)
    const jwt = decodeJwt(call!.authorization.slice('bearer '.length))
    expect(jwt.header.alg).toBe('RS256')
    expect(String(jwt.payload.iss)).toBe('12345')
    expect(Number(jwt.payload.exp) - Number(jwt.payload.iat)).toBeLessThanOrEqual(11 * 60)
    expect(createVerify('RSA-SHA256').update(jwt.signed).verify(publicKey, jwt.signature)).toBe(true)
    // cached
    await app.identity()
    expect(seen).toHaveLength(1)
  })

  test('no installation id: looks the installation up per owner (JWT), then uses the installation token; cached', async () => {
    const { privateKey } = rsaKeys('pkcs1')
    await envOnly({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKey })
    const seen = stubGitHub(routes())
    const gh = await app.client()
    const { data } = await gh.request<{ full_name: string }>('GET /repos/{owner}/{repo}', { owner: 'octo-example', repo: 'demo' })
    expect(data.full_name).toBe('octo-example/demo')
    expect(seen.map((s) => `${s.method} ${s.path} ${s.authorization.split(' ')[0]}`)).toEqual([
      'GET /repos/octo-example/demo/installation bearer',
      'POST /app/installations/777/access_tokens bearer',
      'GET /repos/octo-example/demo token',
    ])
    expect(seen[2]!.authorization).toBe('token ghs_testinstallationtoken')
    await gh.request('GET /repos/{owner}/{repo}', { owner: 'octo-example', repo: 'demo' })
    expect(seen).toHaveLength(4)
  })

  test('installation id set: no lookup; GraphQL with repositoryNameWithOwner routes by owner too', async () => {
    const { privateKey } = rsaKeys()
    await envOnly({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKey, GITHUB_APP_INSTALLATION_ID: '888' })
    const seen = stubGitHub(routes(888))
    await (await app.client()).request('GET /repos/{owner}/{repo}', { owner: 'octo-example', repo: 'demo' })
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual(['POST /app/installations/888/access_tokens', 'GET /repos/octo-example/demo'])
    expect(ownerOf({ input: { branch: { repositoryNameWithOwner: 'octo-example/demo', branchName: 'main' } } })).toBe('octo-example')
    expect(ownerOf({ query: 'x' })).toBeUndefined()
  })

  test('several installations, no installation id: the repo list fans out over every installation', async () => {
    const { privateKey } = rsaKeys()
    await envOnly({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKey })
    const token = (t: string) => ({ status: 201, body: { token: t, expires_at: future(), permissions: {}, repository_selection: 'all' } })
    const seen = stubGitHub({
      'GET /app/installations': [{ id: 777, account: { login: 'alice' } }, { id: 888, account: { login: 'acme' } }],
      'POST /app/installations/777/access_tokens': token('ghs_alice'),
      'POST /app/installations/888/access_tokens': token('ghs_acme'),
      'GET /installation/repositories': (req: { authorization: string }) => ({
        status: 200,
        body: { total_count: 1, repositories: [{ full_name: req.authorization.endsWith('ghs_alice') ? 'alice/one' : 'acme/two' }] },
      }),
      'GET /repos/acme/two': { full_name: 'acme/two' },
    })
    const gh = await app.client()
    const repos = await gh.paginate<{ full_name: string }>('GET /installation/repositories', {}, 100)
    expect(repos.map((r) => r.full_name)).toEqual(['alice/one', 'acme/two'])
    // the account logins primed the owner cache: no per-owner lookup afterwards
    await gh.request('GET /repos/{owner}/{repo}', { owner: 'acme', repo: 'two' })
    expect(seen.some((r) => r.path.endsWith('/installation') && r.path.startsWith('/repos/'))).toBe(false)
    expect((await gh.paginate('GET /installation/repositories', {}, 1)).length).toBe(1)
  })

  test('the App is not installed on the owner → a 404 GitHubError naming it', async () => {
    const { privateKey } = rsaKeys()
    await envOnly({ GITHUB_APP_ID: '12345', GITHUB_APP_PRIVATE_KEY: privateKey })
    stubGitHub({ ...routes(), 'GET /repos/octo-example/demo/installation': { status: 404, body: { message: 'Not Found' } } })
    const err = await (await app.client()).request('GET /repos/{owner}/{repo}', { owner: 'octo-example', repo: 'demo' }).catch((e) => e)
    expect(err.status).toBe(404)
    expect(err.message).toBe('the GitHub App is not installed on octo-example')
  })

  test('settings win over env; source octoforge when delivered', async () => {
    await closeDb()
    resetSettingsCache()
    const env = rsaKeys()
    const cfg = loadConfig({ DATA_DIR: '/nonexistent-octowarden-test', DATABASE_URL: 'sqlite::memory:', LOG_LEVEL: 'error', GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: env.privateKey })
    setConfig(cfg)
    await boot(cfg)
    await setSetting('log_level', 'error')
    const { privateKey } = rsaKeys()
    await setSetting('github_app_id', '12345')
    await setSetting('github_app_private_key', privateKey)
    expect(await app.source()).toBe('settings')
    await setSetting('github_credential_source', 'octoforge')
    expect(await app.source()).toBe('octoforge')
    const seen = stubGitHub(routes())
    await app.identity()
    expect(String(decodeJwt(seen[0]!.authorization.slice(7)).payload.iss)).toBe('12345')
  })
})
