import { GitHubError, type GitHubClient, type GitHubResponse, type RouteParams } from './client'

export type FakeHandler = (params: RouteParams) => unknown | Promise<unknown>
export type FakeCall = { route: string; params: RouteParams }

/**
 * In-memory GitHubClient for tests and offline demos. `on(route, handler)` answers a route template
 * (`'GET /repos/{owner}/{repo}'`); a handler may throw `fakeError(status, message)`. Unknown routes throw 404.
 */
export function createFakeGitHub(mode = 'fake') {
  const handlers = new Map<string, FakeHandler>()
  const calls: FakeCall[] = []
  let graphqlHandler: ((query: string, variables: RouteParams) => unknown) | undefined

  const call = async (route: string, params: RouteParams) => {
    calls.push({ route, params })
    if (calls.length > 10_000) calls.shift()
    const h = handlers.get(route)
    if (!h) throw new GitHubError(`fake: no handler for ${route}`, 404, route)
    return h(params)
  }

  const client: GitHubClient & {
    on(route: string, handler: FakeHandler): void
    onGraphql(handler: (query: string, variables: RouteParams) => unknown): void
    calls: FakeCall[]
  } = {
    mode,
    calls,
    on: (route, handler) => void handlers.set(route, handler),
    onGraphql: (handler) => void (graphqlHandler = handler),
    async request<T>(route: string, params: RouteParams = {}): Promise<GitHubResponse<T>> {
      const data = await call(route, params)
      return { status: route.startsWith('DELETE') && data === undefined ? 204 : 200, data: data as T, headers: {} }
    },
    async paginate<T>(route: string, params: RouteParams = {}, maxItems = 1000): Promise<T[]> {
      const data = await call(route, params)
      return (Array.isArray(data) ? data : []).slice(0, maxItems) as T[]
    },
    async graphql<T>(query: string, variables: RouteParams = {}): Promise<T> {
      calls.push({ route: 'POST /graphql', params: { query, ...variables } })
      if (!graphqlHandler) throw new GitHubError('fake: no graphql handler', 404, 'POST /graphql')
      return (await graphqlHandler(query, variables)) as T
    },
  }
  return client
}

export type FakeGitHub = ReturnType<typeof createFakeGitHub>

export function fakeError(status: number, message: string, route = 'fake'): GitHubError {
  return new GitHubError(message, status, route)
}
