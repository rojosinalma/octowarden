import { Elysia } from 'elysia'
import { codeFor, errBody, errorResult, validationMessage } from './lib/json'
import { watchGitHubStatus } from './github/status'
import { log } from './lib/log'
import * as api from './routes/api'
import * as health from './routes/health'
import * as mcp from './routes/mcp'
import * as metrics from './routes/metrics'
import * as octoforge from './routes/octoforge'
import * as ui from './routes/ui'

const logger = log.child('http')

/**
 * The HTTP app without listening (tests call `createApp().handle(request)`). Each route module exports
 * `register(app)`; octoforge registers before api so `/api/octoforge/*` is matched by its own guard.
 * Errors: AppError keeps its status, ZodError/validation → 422, anything else → 500 (stack logged, not sent).
 */
export function createApp() {
  const app = new Elysia()
    .onError(({ code, error, path, set }) => {
      const fail = (status: number, message: string) => {
        set.status = status
        return errBody(message, codeFor(status))
      }
      if (code === 'NOT_FOUND') return fail(404, `no route ${path}`)
      if (code === 'VALIDATION') return fail(422, validationMessage(error))
      if (code === 'PARSE') return fail(400, 'request body is not valid JSON')
      const { status, body } = errorResult(error)
      set.status = status
      return body
    })
    .onAfterResponse(({ request, path, set, responseValue }) => {
      const status = responseValue instanceof Response ? responseValue.status : (set.status ?? 200)
      const line = `${request.method} ${path} → ${status}`
      if (path === '/health' || path === '/metrics') logger.debug(line)
      else logger.info(line)
    })
  watchGitHubStatus()
  health.register(app)
  metrics.register(app)
  octoforge.register(app)
  api.register(app)
  mcp.register(app)
  ui.register(app)
  return app
}

export type App = ReturnType<typeof createApp>
