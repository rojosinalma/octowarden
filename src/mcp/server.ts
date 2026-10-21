import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { errorResult } from '../lib/json'
import { log } from '../lib/log'
import { VERSION } from '../lib/version'
import { MCP_CTX } from '../services'
import { tools } from './tools'

const logger = log.child('mcp')

/** One MCP server with every tool; one instance serves one client session. Actor is always `mcp`. */
export function createServer(): McpServer {
  const server = new McpServer({ name: 'octowarden', version: VERSION })
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { destructiveHint: tool.destructive, readOnlyHint: tool.readOnly },
      },
      async (args: Record<string, unknown>) => {
        const client = server.server.getClientVersion()?.name ?? 'unknown'
        try {
          const result = await tool.handler(args as never, MCP_CTX)
          logger.info(`${client} ${tool.name} ok`)
          return { content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result ?? null) }] }
        } catch (err) {
          // AppError/ZodError keep their reason and code; anything else is logged with its stack and answered as "internal error".
          const { status, body } = errorResult(err)
          if (status < 500) logger.warn(`${client} ${tool.name} rejected (${body.code}): ${body.message}`)
          return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(body) }] }
        }
      },
    )
  }
  return server
}
