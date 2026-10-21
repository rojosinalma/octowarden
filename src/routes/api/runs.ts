import type { AnyElysia } from 'elysia'
import { z } from 'zod'
import { jsonOk } from '../../lib/json'
import { getRun, listEvents, listRuns, type EventQuery } from '../../services'

const runsQuery = z.object({ limit: z.coerce.number().int().min(1).max(200).optional(), kind: z.enum(['plan', 'apply', 'sync', 'audit']).optional() })

export function routes(app: AnyElysia) {
  app
    .get('/runs', async ({ query }) => jsonOk('ok', { runs: await listRuns(runsQuery.parse(query)) }))
    .get('/runs/:id', async ({ params }) => jsonOk('ok', { run: await getRun(params.id) }))
    .get('/events', async ({ query }) => {
      const events = await listEvents(query as EventQuery)
      return jsonOk(`${events.length} events`, { events })
    })
}
