import type { AnyElysia } from 'elysia'
import { jsonOk, ValidationError } from '../../lib/json'
import { exportYaml, importYaml } from '../../services'
import { MAX_YAML_BYTES } from '../../templates/schema'
import { ctx, flagParam, listParam } from './shared'

/** Import body: raw YAML (`text/yaml`, `application/yaml`, `text/plain`) or JSON `{yaml}`. */
async function yamlOf(request: Request): Promise<string> {
  const length = Number(request.headers.get('content-length') ?? 0)
  if (length > MAX_YAML_BYTES) throw new ValidationError(`YAML too large (max ${MAX_YAML_BYTES} bytes)`)
  const text = await request.text()
  if (text.length > MAX_YAML_BYTES) throw new ValidationError(`YAML too large (max ${MAX_YAML_BYTES} bytes)`)
  if ((request.headers.get('content-type') ?? '').includes('json')) {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new ValidationError('request body is not valid JSON')
    }
    const yaml = (parsed as { yaml?: unknown })?.yaml
    if (typeof yaml !== 'string') throw new ValidationError('JSON body needs {yaml: "<documents>"}')
    return yaml
  }
  return text
}

export function routes(app: AnyElysia) {
  app
    .get('/export', async ({ query }) => {
      const yaml = await exportYaml({ templates: listParam(query.templates), sets: listParam(query.sets), manifest: flagParam(query.manifest) })
      return new Response(yaml, { headers: { 'content-type': 'text/yaml; charset=utf-8', 'content-disposition': 'attachment; filename="octowarden.yaml"' } })
    })
    .post(
      '/import',
      async ({ request }) => {
        const counts = await importYaml(await yamlOf(request), ctx)
        return jsonOk(`imported ${counts.templates} templates, ${counts.sets} sets, ${counts.repos} repos`, { counts })
      },
      { parse: 'none' },
    )
}
