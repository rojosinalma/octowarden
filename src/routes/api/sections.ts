import type { AnyElysia } from 'elysia'
import { jsonOk } from '../../lib/json'
import { listSectionInfo } from '../../services'

export function routes(app: AnyElysia) {
  app.get('/sections', () => jsonOk('ok', { sections: listSectionInfo() }))
}
