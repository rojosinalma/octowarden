import { bus, type BusTopics, type Topic } from './bus'
import { errBody } from './json'
import { log } from './log'
import { getSettingInt } from './settings'

const logger = log.child('http')
export const HEARTBEAT_MS = 25_000
export const SSE_TOPICS: readonly Topic[] = ['event', 'run', 'drift', 'settings']

type Client = { close(): void }
const clients = new Set<Client>()

/** Open SSE connections (every stream shares the `sse_max_clients` cap). */
export function sseClients(): number {
  return clients.size
}

/** Closes every stream (shutdown). */
export function closeAllStreams(): void {
  for (const c of [...clients]) c.close()
}

/** `?topics=run,drift` → valid topics; absent or empty → every topic. */
export function parseTopics(value: string | null | undefined): Topic[] {
  if (!value) return [...SSE_TOPICS]
  const wanted = value.split(',').map((s) => s.trim())
  const out = SSE_TOPICS.filter((t) => wanted.includes(t))
  return out.length ? out : [...SSE_TOPICS]
}

type SetLike = { status?: number | string; headers: Record<string, string | number> }

/**
 * Server-Sent Events from the bus: `event: <topic>\ndata: <json>`. Capped by `sse_max_clients` (503 beyond),
 * closed after `sse_idle_s` without a bus message, `: ping` every 25 s for proxies. Unsubscribes on disconnect.
 */
export async function sseHandler(request: Request, set: SetLike, topics: readonly Topic[] = SSE_TOPICS): Promise<Response | object> {
  const max = await getSettingInt('sse_max_clients')
  if (clients.size >= max) {
    set.status = 503
    return errBody(`too many stream clients (max ${max})`, 'unavailable')
  }
  const idleMs = Math.max(1, await getSettingInt('sse_idle_s')) * 1000
  const encoder = new TextEncoder()
  let client: Client | undefined

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let done = false
      const unsubs: (() => void)[] = []
      let idle: Timer
      const cleanup = () => {
        if (done) return
        done = true
        clearTimeout(idle)
        clearInterval(heartbeat)
        for (const u of unsubs) u()
        request.signal.removeEventListener('abort', cleanup)
        if (client) clients.delete(client)
        try {
          controller.close()
        } catch {
          // the client already went away
        }
        logger.debug(`stream client left (${clients.size} open)`)
      }
      const write = (chunk: string) => {
        if (done) return
        try {
          controller.enqueue(encoder.encode(chunk))
        } catch {
          cleanup()
        }
      }
      const touch = () => {
        clearTimeout(idle)
        idle = setTimeout(cleanup, idleMs)
      }
      idle = setTimeout(cleanup, idleMs)
      const heartbeat = setInterval(() => write(': ping\n\n'), HEARTBEAT_MS)
      client = { close: cleanup }
      clients.add(client)
      request.signal.addEventListener('abort', cleanup)
      for (const topic of topics) {
        const unsub = bus.subscribe(topic, (payload: BusTopics[typeof topic]) => {
          write(`event: ${topic}\ndata: ${JSON.stringify(payload)}\n\n`)
          touch()
        })
        if (!unsub) {
          write(`event: error\ndata: ${JSON.stringify({ message: `subscriber limit reached on ${topic}` })}\n\n`)
          cleanup()
          return
        }
        unsubs.push(unsub)
      }
      write(': connected\n\n')
      logger.debug(`stream client joined (${clients.size} open)`)
    },
    cancel() {
      client?.close()
    },
  })
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive', 'x-accel-buffering': 'no' },
  })
}
