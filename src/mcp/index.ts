import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import { createServer } from './server'
import { getSession, openSession } from './sessions'

export { closeAllSessions, sessionCount } from './sessions'

const SESSION_HEADER = 'mcp-session-id'

const rpcError = (status: number, code: number, message: string) => Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status })

/** Routes one HTTP request to its MCP session (Streamable HTTP); a session starts with `initialize`. */
export async function handleMcpRequest(request: Request): Promise<Response> {
  const sessionId = request.headers.get(SESSION_HEADER)
  if (sessionId) {
    const transport = getSession(sessionId)
    if (!transport) return rpcError(404, -32001, 'Session not found; send initialize again')
    return transport.handleRequest(request)
  }
  if (request.method !== 'POST') return rpcError(400, -32000, `Bad request: ${SESSION_HEADER} header required`)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return rpcError(400, -32700, 'Parse error: body is not JSON')
  }
  const init = Array.isArray(body) ? body.some(isInitializeRequest) : isInitializeRequest(body)
  if (!init) return rpcError(400, -32000, 'Bad request: first request must be initialize')
  const transport = await openSession(createServer())
  return transport.handleRequest(request, { parsedBody: body })
}
