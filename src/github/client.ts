import { Octokit } from '@octokit/rest'
import { GraphqlResponseError } from '@octokit/graphql'
import { log, type Logger } from '../lib/log'
import { createSemaphore } from '../lib/semaphore'
import { getSettingInt } from '../lib/settings'

export type RouteParams = Record<string, unknown>
export type GitHubResponse<T> = { status: number; data: T; headers: Record<string, string | number | undefined> }

/** Last seen rate limit per resource (`core`, `graphql`, `search`, …). */
export type RateLimit = { resource: string; limit: number; remaining: number; reset: number; at: number }

/** Any GitHub failure: HTTP status (0 = network), the route template and GitHub's own message. */
export class GitHubError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly route: string,
    readonly data?: unknown,
  ) {
    super(message)
    this.name = 'GitHubError'
  }
}

/**
 * The only way code talks to GitHub. Sections use `request`/`paginate`/`graphql` (never Octokit directly) so
 * tests can pass a fake (src/github/fake.ts). Every call is logged, counted against the shared concurrency
 * limit (`github_concurrency`) and updates the rate-limit snapshot. Failures throw GitHubError.
 */
export interface GitHubClient {
  /** Which auth provider built this client (`pat`, `gh`, `app`, `fake`). */
  readonly mode: string
  /** Octokit route, e.g. `request('GET /repos/{owner}/{repo}', { owner, repo })`. */
  request<T = any>(route: string, params?: RouteParams): Promise<GitHubResponse<T>>
  /** Every page of a list route, concatenated (max `maxItems`, default 1000). */
  paginate<T = any>(route: string, params?: RouteParams, maxItems?: number): Promise<T[]>
  graphql<T = any>(query: string, variables?: RouteParams): Promise<T>
}

const logger = log.child('github')
const rates = new Map<string, RateLimit>()
let concurrency = 4
const semaphore = createSemaphore(() => concurrency)

/** Snapshot for /metrics and /health. */
export function rateLimits(): RateLimit[] {
  return [...rates.values()]
}

/** Calls in flight and waiting on the shared limit. */
export function githubLoad(): { active: number; waiting: number } {
  return { active: semaphore.active(), waiting: semaphore.waiting() }
}

function captureRate(headers: Record<string, unknown> | undefined): RateLimit | undefined {
  if (!headers) return undefined
  const remaining = Number(headers['x-ratelimit-remaining'])
  if (!Number.isFinite(remaining)) return undefined
  const rate: RateLimit = {
    resource: String(headers['x-ratelimit-resource'] ?? 'core'),
    limit: Number(headers['x-ratelimit-limit'] ?? 0),
    remaining,
    reset: Number(headers['x-ratelimit-reset'] ?? 0),
    at: Date.now(),
  }
  rates.set(rate.resource, rate)
  return rate
}

function githubMessage(err: unknown): string {
  const data = (err as { response?: { data?: { message?: string } } }).response?.data
  return data?.message ?? (err instanceof Error ? err.message : String(err))
}

export type ClientOptions = {
  mode: string
  /** Token string (PAT, gh) — or omit and pass authStrategy/auth for an App. */
  auth?: unknown
  authStrategy?: unknown
  baseUrl?: string
  logger?: Logger
}

/** Builds a GitHubClient on Octokit with the logging/concurrency/rate hook. */
export function createGitHubClient(opts: ClientOptions): GitHubClient {
  const l = opts.logger ?? logger
  const octokit = new Octokit({
    auth: opts.auth,
    authStrategy: opts.authStrategy as never,
    baseUrl: opts.baseUrl,
    userAgent: 'octowarden',
    log: { debug: () => {}, info: () => {}, warn: (m: string) => l.warn(m), error: (m: string) => l.error(m) },
  })

  octokit.hook.wrap('request', async (request, options) => {
    concurrency = await getSettingInt('github_concurrency').catch(() => concurrency)
    const route = `${options.method} ${String(options.url).replace(/^https:\/\/[^/]+/, '')}`
    return semaphore.run(async () => {
      try {
        const res = await request(options)
        const rate = captureRate(res.headers as Record<string, unknown>)
        l.info(`${route} → ${res.status}${rate ? ` (rate remaining ${rate.remaining})` : ''}`)
        return res
      } catch (err) {
        const e = err as { status?: number; response?: { headers?: Record<string, unknown> } }
        const rate = captureRate(e.response?.headers)
        const status = typeof e.status === 'number' ? e.status : 0
        l.warn(`${route} → ${status || 'network error'}${rate ? ` (rate remaining ${rate.remaining})` : ''}: ${githubMessage(err)}`)
        throw err
      }
    })
  })

  const wrapErr = (route: string, err: unknown): GitHubError => {
    if (err instanceof GitHubError) return err
    if (err instanceof GraphqlResponseError) {
      return new GitHubError(err.errors?.map((x) => x.message).join('; ') || err.message, 200, route, err.errors)
    }
    const status = (err as { status?: number }).status
    return new GitHubError(githubMessage(err), typeof status === 'number' ? status : 0, route, (err as { response?: { data?: unknown } }).response?.data)
  }

  return {
    mode: opts.mode,
    async request<T>(route: string, params: RouteParams = {}) {
      try {
        const res = await octokit.request(route, params)
        return { status: res.status, data: res.data as T, headers: res.headers as GitHubResponse<T>['headers'] }
      } catch (err) {
        throw wrapErr(route, err)
      }
    },
    async paginate<T>(route: string, params: RouteParams = {}, maxItems = 1000) {
      const out: T[] = []
      try {
        for await (const page of octokit.paginate.iterator(route, { per_page: 100, ...params })) {
          for (const item of page.data as T[]) {
            out.push(item)
            if (out.length >= maxItems) return out
          }
        }
        return out
      } catch (err) {
        throw wrapErr(route, err)
      }
    },
    async graphql<T>(query: string, variables: RouteParams = {}) {
      try {
        return (await octokit.graphql(query, variables)) as T
      } catch (err) {
        throw wrapErr('POST /graphql', err)
      }
    },
  }
}

/** True for the 403/404 answers GitHub gives when the plan or visibility does not allow a feature. */
export function isPlanLimit(err: unknown): err is GitHubError {
  if (!(err instanceof GitHubError)) return false
  if (err.status !== 403 && err.status !== 404 && err.status !== 422) return false
  return /upgrade to github pro|make this repository public|not available|feature is not enabled|advanced security/i.test(err.message)
}
