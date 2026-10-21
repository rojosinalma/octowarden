import type { AnyElysia } from 'elysia'
import { jsonOk, ValidationError } from '../../lib/json'
import { deleteSet, getSet, listSets, saveSet } from '../../services'
import type { SetDoc } from '../../templates/schema'
import { bodyOf, confirmBody, ctx } from './shared'

export function routes(app: AnyElysia) {
  app
    .get('/sets', async () => jsonOk('ok', { sets: await listSets() }))
    .get('/sets/:name', async ({ params }) => jsonOk('ok', { set: await getSet(params.name) }))
    .put('/sets/:name', async ({ params, body, set: res }) => {
      const doc = bodyOf(body) as SetDoc
      if (doc.metadata?.name !== params.name) throw new ValidationError(`metadata.name must be "${params.name}" (the name in the URL)`)
      const { set, created } = await saveSet(doc, ctx)
      if (created) res.status = 201
      return jsonOk(`set ${set.name} ${created ? 'created' : 'updated'}`, { set })
    })
    .delete('/sets/:name', async ({ params, body }) => {
      const { confirm } = confirmBody.parse(bodyOf(body))
      await deleteSet(params.name, confirm, ctx)
      return jsonOk(`set ${params.name} deleted`, { set: params.name })
    })
}
