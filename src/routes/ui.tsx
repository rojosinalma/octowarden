import type { AnyElysia } from 'elysia'
import { registerActions } from './ui/actions'
import { registerPages } from './ui/pages'
import { serveStatic } from './ui/shared'

/**
 * Server-rendered UI (kitajs + tailor), mounted last so /api, /mcp and /health win. No auth here: the
 * reverse proxy gates `/` and `/ui/*`. Pages are HTML; `/ui/actions/*` answer `{ok, message, …}` JSON.
 * `GET /ui/stream` (SSE) is registered by the API module.
 */
export function register<A extends AnyElysia>(app: A): A {
  app
    .get('/public/*', ({ params }) => serveStatic((params as Record<string, string>)['*'] ?? ''))
    .get('/tailor/*', ({ params }) => serveStatic(`tailor/${(params as Record<string, string>)['*'] ?? ''}`))
    .get('/favicon.svg', () => serveStatic('favicon.svg'))
    .get('/favicon-sibling.svg', () => serveStatic('favicon-sibling.svg'))
    .get('/favicon.ico', () => serveStatic('favicon.svg'))
  registerPages(app)
  registerActions(app)
  return app
}
