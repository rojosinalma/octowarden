import type { AnyElysia } from 'elysia'
import { config } from '../lib/config'
import { parseTopics, sseHandler } from '../lib/sse'
import * as plans from './api/plans'
import * as portability from './api/portability'
import * as repos from './api/repos'
import * as runs from './api/runs'
import * as sections from './api/sections'
import * as sets from './api/sets'
import * as settings from './api/settings'
import * as templates from './api/templates'
import { requireBearer } from './guard'

const MODULES = [sections, templates, sets, repos, plans, runs, portability, settings]

/**
 * JSON API under `/api/*` (`{ok, message, …}`), bearer `API_TOKEN` (503 while unset, 401 on mismatch).
 * Also the event streams: `GET /api/stream` (bearer) and `GET /ui/stream` (no auth; the proxy gates the UI).
 * Both take `?topics=event,run,drift,settings`.
 */
export function register<A extends AnyElysia>(app: A): A {
  const guard = requireBearer(() => config().apiToken, { name: 'API_TOKEN' })
  ;(app as AnyElysia).group('/api', (api: AnyElysia) =>
    api.guard({ beforeHandle: guard as never }, (g: AnyElysia) => {
      for (const m of MODULES) m.routes(g)
      g.get('/stream', ({ request, set, query }) => sseHandler(request, set, parseTopics(query.topics)))
      return g
    }),
  )
  app.get('/ui/stream', ({ request, set, query }) => sseHandler(request, set, parseTopics((query as Record<string, string>).topics)))
  return app
}
