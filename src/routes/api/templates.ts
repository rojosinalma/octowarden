import type { AnyElysia } from 'elysia'
import { jsonOk, ValidationError } from '../../lib/json'
import { deleteTemplate, getTemplate, listTemplates, saveTemplate } from '../../services'
import type { TemplateDoc } from '../../templates/schema'
import { bodyOf, confirmBody, ctx } from './shared'

export function routes(app: AnyElysia) {
  app
    .get('/templates', async () => jsonOk('ok', { templates: await listTemplates() }))
    .get('/templates/:name', async ({ params }) => jsonOk('ok', { template: await getTemplate(params.name) }))
    .put('/templates/:name', async ({ params, body, set }) => {
      const doc = bodyOf(body) as TemplateDoc
      if (doc.metadata?.name !== params.name) throw new ValidationError(`metadata.name must be "${params.name}" (the name in the URL)`)
      const { template, created } = await saveTemplate(doc, ctx)
      if (created) set.status = 201
      return jsonOk(`template ${template.name} ${created ? 'created' : 'updated'}`, { template })
    })
    .delete('/templates/:name', async ({ params, body }) => {
      const { confirm } = confirmBody.parse(bodyOf(body))
      await deleteTemplate(params.name, confirm, ctx)
      return jsonOk(`template ${params.name} deleted`, { template: params.name })
    })
}
