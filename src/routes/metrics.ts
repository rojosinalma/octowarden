import type { AnyElysia } from 'elysia'
import { registry, watchRuns } from '../lib/metrics'

/** Prometheus `GET /metrics` (own registry, no auth like /health; keep it off the public path at the proxy). */
export function register<A extends AnyElysia>(app: A): A {
  watchRuns()
  app.get('/metrics', async () => new Response(await registry.metrics(), { headers: { 'content-type': registry.contentType } }))
  return app
}
