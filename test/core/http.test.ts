import { beforeEach, describe, expect, test } from 'bun:test'
import { VERSION } from '../../src/lib/version'
import { fresh } from './helpers'
import { createApp } from '../../src/app'
import { setGitHubClient } from '../../src/auth/providers'
import { closeDb } from '../../src/db'
import { bearerToken, requireBearer, safeEqual } from '../../src/routes/guard'
import { Elysia } from 'elysia'

beforeEach(async () => {
  await fresh()
})

describe('http', () => {
  test('GET /health: 200 with db ok and the github mode', async () => {
    const res = await createApp().handle(new Request('http://localhost/health'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, db: 'ok', version: VERSION, github: { mode: 'fake' } })
  })

  test('GET /health: 503 when the database is down', async () => {
    setGitHubClient(undefined)
    await closeDb()
    const res = await createApp().handle(new Request('http://localhost/health'))
    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({ ok: false, db: 'down' })
  })

  test('unknown route: 404 JSON', async () => {
    const res = await createApp().handle(new Request('http://localhost/nope'))
    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ ok: false, message: 'no route /nope', code: 'not_found' })
  })
})

describe('bearer guard', () => {
  const app = (token: string | undefined, unsetStatus?: 404 | 503) =>
    new Elysia().guard({ beforeHandle: requireBearer(() => token, { name: 'API_TOKEN', unsetStatus }) }, (g) => g.get('/p', () => ({ ok: true })))
  const get = (a: ReturnType<typeof app>, auth?: string) =>
    a.handle(new Request('http://localhost/p', { headers: auth ? { authorization: auth } : {} }))

  test('fail-closed: 503 while the token is unset (404 for octoforge)', async () => {
    const res = await get(app(undefined), 'Bearer x')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { message: string }).message).toBe('API_TOKEN not configured')
    expect((await get(app(undefined, 404), 'Bearer x')).status).toBe(404)
  })

  test('401 without or with a wrong bearer, 200 with the right one', async () => {
    expect((await get(app('s3cret'))).status).toBe(401)
    expect((await get(app('s3cret'), 'Bearer nope')).status).toBe(401)
    expect((await get(app('s3cret'), 'Bearer s3cret')).status).toBe(200)
  })

  test('helpers', () => {
    expect(bearerToken('Bearer abc')).toBe('abc')
    expect(bearerToken('Basic abc')).toBeUndefined()
    expect(safeEqual('a', 'a')).toBe(true)
    expect(safeEqual('a', 'ab')).toBe(false)
  })
})
