import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { log } from '../lib/log'
import { getSettingInt } from '../lib/settings'

const logger = log.child('mcp')

type Session = { transport: WebStandardStreamableHTTPServerTransport; server: McpServer; lastUsedAt: number }

// In-memory session table, capped by `mcp_max_sessions`; idle sessions go after `mcp_session_idle_min`,
// and a full table drops the least recently used. Clients re-initialise on 404 (MCP spec).
const sessions = new Map<string, Session>()

async function drop(id: string, reason: string): Promise<void> {
  const s = sessions.get(id)
  if (!s) return
  sessions.delete(id)
  logger.debug(`session ${id} closed (${reason})`)
  await s.server.close().catch(() => undefined)
}

export async function evict(now = Date.now()): Promise<void> {
  const idleMs = (await getSettingInt('mcp_session_idle_min')) * 60_000
  const max = Math.max(1, await getSettingInt('mcp_max_sessions'))
  for (const [id, s] of sessions) if (now - s.lastUsedAt > idleMs) await drop(id, 'idle')
  while (sessions.size >= max) {
    let oldest: [string, Session] | undefined
    for (const e of sessions) if (!oldest || e[1].lastUsedAt < oldest[1].lastUsedAt) oldest = e
    if (!oldest) break
    await drop(oldest[0], 'table full')
  }
}

/** Session-bound transport with a fresh server connected to it. */
export async function openSession(server: McpServer): Promise<WebStandardStreamableHTTPServerTransport> {
  await evict()
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    onsessioninitialized: (id) => {
      sessions.set(id, { transport, server, lastUsedAt: Date.now() })
      logger.info(`session ${id} opened by ${server.server.getClientVersion()?.name ?? 'unknown'}`)
    },
    onsessionclosed: (id) => drop(id, 'client delete'),
  })
  await server.connect(transport)
  return transport
}

export function getSession(id: string): WebStandardStreamableHTTPServerTransport | undefined {
  const s = sessions.get(id)
  if (!s) return undefined
  s.lastUsedAt = Date.now()
  return s.transport
}

export function sessionCount(): number {
  return sessions.size
}

/** Closes every session (shutdown, tests). */
export async function closeAllSessions(): Promise<void> {
  for (const id of [...sessions.keys()]) await drop(id, 'shutdown')
}
