import { beforeEach, describe, expect, test } from 'bun:test'
import { fresh } from './helpers'
import { bus } from '../../src/lib/bus'
import { errorResult, jsonOk, NotFoundError, ValidationError } from '../../src/lib/json'
import { log, redact, redactUrl } from '../../src/lib/log'
import { createSemaphore } from '../../src/lib/semaphore'
import {
  allSettings,
  DEFAULTS,
  getSetting,
  getSettingBool,
  getSettingInt,
  publicSettings,
  SECRET_KEYS,
  setSetting,
} from '../../src/lib/settings'
import { z } from 'zod'

beforeEach(async () => {
  await fresh()
})

describe('settings', () => {
  test('seeded defaults are readable', async () => {
    expect(await getSetting('ui_skin')).toBe('luz')
    expect(await getSetting('ui_palette')).toBe('ayu')
    expect(await getSettingInt('audit_retention_days')).toBe(30)
    expect(await getSettingBool('notify_on_drift')).toBe(true)
    expect(Object.keys(await allSettings()).sort()).toEqual(Object.keys(DEFAULTS).sort())
  })

  test('set invalidates the cache and publishes the key only', async () => {
    const seen: unknown[] = []
    bus.subscribe('settings', (p) => seen.push(p))
    await getSetting('github_concurrency')
    await setSetting('github_concurrency', '8')
    expect(await getSettingInt('github_concurrency')).toBe(8)
    expect(seen).toEqual([{ key: 'github_concurrency' }])
  })

  test('bad integers fall back to the default', async () => {
    await setSetting('audit_interval_min', 'soon')
    expect(await getSettingInt('audit_interval_min')).toBe(360)
  })

  test('publicSettings masks every secret', async () => {
    await setSetting('github_token', 'ghp_secret')
    const pub = await publicSettings()
    expect(pub.github_token).toBe('set')
    expect(pub.github_app_private_key).toBe('')
    for (const k of SECRET_KEYS) expect(['set', '']).toContain(pub[k])
  })
})

describe('log', () => {
  test('redact masks secret-looking keys deeply', () => {
    const out = redact({ a: 1, github_token: 'x', nested: { Authorization: 'Bearer y', list: [{ password: 'p', ok: 2 }] }, private_key: '' })
    expect(out).toEqual({ a: 1, github_token: '***', nested: { Authorization: '***', list: [{ password: '***', ok: 2 }] }, private_key: '' })
    expect(redact({ notify_discord_webhook: 'https://x' }, ['notify_discord_webhook'])).toEqual({ notify_discord_webhook: '***' })
    expect(redactUrl('postgres://u:p@h/db')).toBe('postgres://***@h/db')
  })
  test('child loggers nest', () => {
    expect(typeof log.child('github').child('app').info).toBe('function')
  })
})

describe('json', () => {
  test('jsonOk spreads data', () => {
    expect(jsonOk('done', { a: 1 })).toEqual({ ok: true, message: 'done', a: 1 })
    expect(jsonOk()).toEqual({ ok: true, message: 'ok' })
  })
  test('errorResult distinguishes validation, app and system errors', () => {
    expect(errorResult(new ValidationError('bad', { field: 'x' }))).toEqual({ status: 422, body: { ok: false, message: 'bad', code: 'invalid', field: 'x' } })
    expect(errorResult(new NotFoundError('gone')).status).toBe(404)
    const zerr = z.object({ a: z.string() }).safeParse({ a: 1 }).error!
    const r = errorResult(zerr)
    expect(r.status).toBe(422)
    expect(r.body.message).toMatch(/^a: /)
    const sys = errorResult(new Error('db exploded with secret'))
    expect(sys).toEqual({ status: 500, body: { ok: false, message: 'internal error', code: 'internal' } })
  })
})

describe('semaphore', () => {
  test('never runs more than the limit at once', async () => {
    const s = createSemaphore(() => 2)
    let running = 0
    let peak = 0
    await Promise.all(
      Array.from({ length: 8 }, () =>
        s.run(async () => {
          running++
          peak = Math.max(peak, running)
          await Bun.sleep(2)
          running--
        }),
      ),
    )
    expect(peak).toBe(2)
    expect(s.active()).toBe(0)
  })
  test('rejects past the queue cap', async () => {
    const s = createSemaphore(() => 1, 1)
    const gate = Promise.withResolvers<void>()
    const a = s.run(() => gate.promise)
    const b = s.run(async () => 1)
    await expect(s.run(async () => 2)).rejects.toThrow(/too many/)
    gate.resolve()
    await a
    expect(await b).toBe(1)
  })
})

describe('bus', () => {
  test('caps subscribers per topic', async () => {
    const { createBus } = await import('../../src/lib/bus')
    const b = createBus(2)
    expect(b.subscribe('run', () => {})).toBeFunction()
    const off = b.subscribe('run', () => {})!
    expect(b.subscribe('run', () => {})).toBeUndefined()
    off()
    expect(b.count('run')).toBe(1)
  })
})
