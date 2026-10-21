import type { AnyElysia } from 'elysia'
import { config } from '../lib/config'
import { handleMcpRequest } from '../mcp'
import { requireBearer } from './guard'

/** MCP over Streamable HTTP at `/mcp` (GET, POST, DELETE), bearer `API_TOKEN` like /api (503 unset, 401 wrong). */
export function register<A extends AnyElysia>(app: A): A {
  const guard = requireBearer(() => config().apiToken, { name: 'API_TOKEN' })
  ;(app as AnyElysia).guard({ beforeHandle: guard as never }, (g: AnyElysia) => g.all('/mcp', ({ request }) => handleMcpRequest(request), { parse: 'none' }))
  return app
}
