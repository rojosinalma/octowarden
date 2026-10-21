import { expect, test } from 'bun:test'
import { maskUrls } from '../../src/lib/events'

test('maskUrls keeps origin and first path segment only', () => {
  expect(maskUrls('hook https://discord.com/api/webhooks/123/secret-token created')).toBe('hook https://discord.com/api/… created')
  expect(maskUrls({ target: 'https://example.com/hook?key=abc' })).toEqual({ target: 'https://example.com/hook/…' })
  expect(maskUrls(['https://example.com/'])).toEqual(['https://example.com'])
  expect(maskUrls(42)).toBe(42)
})
