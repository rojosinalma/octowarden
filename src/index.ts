import { createApp } from './app'
import { closeDb } from './db'
import { boot } from './lib/boot'
import { config, ConfigError } from './lib/config'
import { onShutdown, shutdown } from './lib/lifecycle'
import { log, setLogLevel } from './lib/log'
import { startScheduler, stopScheduler } from './lib/scheduler'
import { closeAllStreams } from './lib/sse'
import { closeAllSessions } from './mcp'
import { drainBulk } from './services'
import { VERSION } from './lib/version'

const logger = log.child('http')

async function main(): Promise<void> {
  let cfg
  try {
    cfg = config()
  } catch (err) {
    if (err instanceof ConfigError) {
      process.stderr.write(`configuration error: ${err.message}\n`)
      process.exit(1)
    }
    throw err
  }
  setLogLevel(cfg.logLevel)
  if (cfg.databaseSource === 'octoforge') logger.info('database from octoforge adoption file')

  try {
    await boot(cfg)
  } catch (err) {
    logger.error('database start failed', err instanceof Error ? err : String(err))
    process.exit(1)
  }
  onShutdown('db', closeDb)

  const app = createApp().listen(cfg.port)
  onShutdown('http', async () => void (await app.stop()))
  logger.info(`octowarden ${VERSION} listening on :${cfg.port}`)
  if (!cfg.apiToken) logger.warn('API_TOKEN is not set: /api and /mcp answer 503')

  // Hooks run newest first: stop new work, let bulk runs finish, close streams and sessions, then HTTP and the DB.
  startScheduler()
  onShutdown('bulk', () => drainBulk())
  onShutdown('mcp', closeAllSessions)
  onShutdown('sse', closeAllStreams)
  onShutdown('scheduler', stopScheduler)

  let stopping = false
  const stop = async (signal: string) => {
    if (stopping) return
    stopping = true
    logger.info(`${signal}: shutting down`)
    await shutdown()
    process.exit(0)
  }
  process.on('SIGTERM', () => void stop('SIGTERM'))
  process.on('SIGINT', () => void stop('SIGINT'))
}

process.on('unhandledRejection', (err) => logger.error('unhandled rejection', err instanceof Error ? err : String(err)))

void main()
