import { CliError, type Backend, type DriftLike, type Listed, type PlanLike, type ReportLike } from './backend'

type Fetch = (input: string, init?: RequestInit) => Promise<Response>
type Answer = { ok: boolean; message?: string; code?: string } & Record<string, unknown>

export type ServerOptions = { url: string; token?: string; fetch: Fetch; sleep?: (ms: number) => Promise<void>; auditTimeoutMs?: number }

/** The HTTP API (`/api/*`, bearer token) as a Backend. */
export function serverBackend(opts: ServerOptions): Backend {
  const base = opts.url.replace(/\/+$/, '')
  if (!/^https?:\/\//.test(base)) throw new CliError(`--server must be an http(s) URL, got "${opts.url}"`, 'invalid')
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  async function call(method: string, path: string, body?: unknown, raw?: { type: string }): Promise<Answer> {
    const headers: Record<string, string> = { accept: 'application/json' }
    if (opts.token) headers.authorization = `Bearer ${opts.token}`
    let payload: string | undefined
    if (body !== undefined) {
      headers['content-type'] = raw?.type ?? 'application/json'
      payload = raw ? String(body) : JSON.stringify(body)
    }
    let res: Response
    try {
      res = await opts.fetch(`${base}${path}`, { method, headers, body: payload })
    } catch (err) {
      throw new CliError(`cannot reach ${base}: ${(err as Error).message}`, 'unavailable')
    }
    const text = await res.text()
    let data: Answer
    try {
      data = text ? (JSON.parse(text) as Answer) : { ok: res.ok }
    } catch {
      if (res.ok && method === 'GET') return { ok: true, text }
      throw new CliError(`${method} ${path}: unexpected answer (${res.status})`, 'upstream')
    }
    if (!res.ok || data.ok === false) {
      const hint = res.status === 401 ? ' (check OCTOWARDEN_TOKEN)' : res.status === 503 && /API_TOKEN/.test(String(data.message)) ? ' (the server has no API_TOKEN set)' : ''
      const { ok: _ok, message, code, ...rest } = data
      throw new CliError(`${message ?? `${method} ${path} failed (${res.status})`}${hint}`, code ?? 'error', rest)
    }
    return data
  }
  const enc = encodeURIComponent
  const repoPath = (full: string) => {
    const [o, n] = full.split('/')
    return `${enc(o ?? '')}/${enc(n ?? '')}`
  }
  const listed = (xs: unknown, kind: 'templates' | 'sets'): Listed[] =>
    ((xs as { name: string; description?: string; builtin?: boolean; sections?: Record<string, unknown>; templates?: string[] }[]) ?? []).map((x) => ({
      name: x.name,
      description: x.description ?? '',
      builtin: x.builtin,
      detail: kind === 'templates' ? Object.keys(x.sections ?? {}).join(', ') : (x.templates ?? []).join(' → '),
    }))
  const yamlOf = async (q: string) => {
    const r = await call('GET', `/api/export?${q}`)
    return String(r.text ?? '')
  }

  return {
    mode: 'server',
    async sections() {
      return (await call('GET', '/api/sections')).sections as { name: string; title: string; description: string }[]
    },
    async templates() {
      return listed((await call('GET', '/api/templates')).templates, 'templates')
    },
    async templateYaml(name) {
      await call('GET', `/api/templates/${enc(name)}`)
      return yamlOf(`templates=${enc(name)}`)
    },
    async sets() {
      return listed((await call('GET', '/api/sets')).sets, 'sets')
    },
    async setYaml(name) {
      await call('GET', `/api/sets/${enc(name)}`)
      return yamlOf(`sets=${enc(name)}`)
    },
    async plan(repo, t) {
      const body = { repo, ...(t.sets.length ? { sets: t.sets } : {}), ...(t.templates.length ? { templates: t.templates } : {}), ...(Object.keys(t.values).length ? { values: t.values } : {}) }
      return (await call('POST', '/api/plan', body)).plan as PlanLike
    },
    async apply(plan, confirm) {
      return (await call('POST', '/api/apply', { plan_id: plan.id, ...(confirm ? { confirm } : {}) })).report as ReportLike
    },
    async syncTargets() {
      const repos = (await call('GET', '/api/repos')).repos as { full_name: string; sets: { set: string }[] }[]
      return repos.filter((r) => r.sets.length).map((r) => ({ repo: r.full_name, sets: [], templates: [], values: {} }))
    },
    async audit(repos) {
      const { run_id } = (await call('POST', '/api/audit', repos.length ? { repos } : {})) as unknown as { run_id: string }
      const deadline = Date.now() + (opts.auditTimeoutMs ?? 10 * 60_000)
      for (;;) {
        const run = (await call('GET', `/api/runs/${enc(run_id)}`)).run as { status: string; summary: { results?: { repo: string; status: string; summary: string; drift?: string }[]; error?: string } }
        if (run.status !== 'running') {
          if (run.summary.error) throw new CliError(`audit run failed: ${run.summary.error}`)
          return (run.summary.results ?? []).map((r): DriftLike => ({ repo: r.repo, state: r.drift ?? (r.status === 'failed' ? 'error' : 'clean'), changes: [], message: r.summary }))
        }
        if (Date.now() > deadline) throw new CliError(`audit run ${run_id} still running; check it later with GET /api/runs/${run_id}`, 'timeout')
        await sleep(2000)
      }
    },
    async exportYaml(o) {
      const q = new URLSearchParams()
      if (o.templates.length) q.set('templates', o.templates.join(','))
      if (o.sets.length) q.set('sets', o.sets.join(','))
      if (o.manifest) q.set('manifest', '1')
      return yamlOf(q.toString())
    },
    async importYaml(text) {
      const counts = (await call('POST', '/api/import', text, { type: 'text/yaml' })).counts as { templates: number; sets: number; repos: number }
      return { stored: true, ...counts }
    },
    async repos() {
      return (await call('GET', '/api/repos')).repos as { full_name: string; visibility: string; sets: { set: string }[]; drift_state: string }[]
    },
    async createRepo(input) {
      const r = await call('POST', '/api/repos', {
        name: input.name,
        private: input.private,
        ...(input.owner ? { owner: input.owner } : {}),
        ...(input.description ? { description: input.description } : {}),
        ...(input.sets.length ? { sets: input.sets.map((set) => ({ set })) } : {}),
      })
      return r.repo as { full_name: string }
    },
    async deleteRepo(fullName, confirm) {
      await call('DELETE', `/api/repos/${repoPath(fullName)}`, { confirm })
    },
  }
}
