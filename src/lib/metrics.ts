import { collectDefaultMetrics, Counter, Gauge, Registry } from 'prom-client'
import { db, dbConnected } from '../db'
import { rateLimits } from '../github/client'
import { isBulkRun } from '../services/bulk'
import { bus } from './bus'
import { driftCounts } from './repos'

export const registry = new Registry()
collectDefaultMetrics({ register: registry, prefix: 'octowarden_' })

const FINAL = new Set(['ok', 'failed', 'partial', 'drift'])

/** Counters follow the bus (`run` finished); gauges read the DB and the rate-limit snapshot on each scrape. */
export const metrics = {
  registry,
  repos: new Gauge({
    name: 'octowarden_repos',
    help: 'Known repos by drift state',
    labelNames: ['drift_state'],
    registers: [registry],
    async collect() {
      if (!dbConnected()) return
      for (const [state, n] of Object.entries(await driftCounts())) this.set({ drift_state: state }, n)
    },
  }),
  applies: new Counter({ name: 'octowarden_applies_total', help: 'Finished applies (one per repo) by outcome', labelNames: ['outcome'], registers: [registry] }),
  runs: new Counter({ name: 'octowarden_runs_total', help: 'Finished runs by kind and status', labelNames: ['kind', 'status'], registers: [registry] }),
  rate: new Gauge({
    name: 'octowarden_github_rate_remaining',
    help: 'GitHub rate limit left, as last seen, by resource',
    labelNames: ['resource'],
    registers: [registry],
    collect() {
      for (const r of rateLimits()) this.set({ resource: r.resource }, r.remaining)
    },
  }),
  lastAudit: new Gauge({
    name: 'octowarden_last_audit_timestamp_seconds',
    help: 'Unix time of the newest repo audit (0 = never)',
    registers: [registry],
    async collect() {
      if (!dbConnected()) return
      const row = await db().selectFrom('repos').select((eb) => eb.fn.max('last_audit_at').as('at')).executeTakeFirst()
      this.set(row?.at ? Math.floor(Date.parse(String(row.at)) / 1000) : 0)
    },
  }),
}

let unsubscribe: (() => void) | undefined

/** (Re)subscribes the counters to the bus; called when the app is built, safe to call again. */
export function watchRuns(): void {
  unsubscribe?.()
  unsubscribe = bus.subscribe('run', (p) => {
    // finishRun publishes {id, kind, status}; bulk progress carries run_id and is skipped.
    if (p.run_id || !FINAL.has(p.status)) return
    metrics.runs.inc({ kind: p.kind || 'unknown', status: p.status })
    if ((p.kind === 'apply' || p.kind === 'sync') && !isBulkRun(p.id)) metrics.applies.inc({ outcome: p.status })
  })
}
