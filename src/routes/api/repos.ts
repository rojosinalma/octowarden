import type { AnyElysia } from 'elysia'
import { z } from 'zod'
import { jsonOk } from '../../lib/json'
import { assignSets, createRepo, deleteRepo, getRepo, listRepos, repoLookups, type CreateRepoInput } from '../../services'
import { bodyOf, confirmBody, ctx, flagParam } from './shared'

const setsBody = z.object({ sets: z.array(z.object({ set: z.string(), values: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional() })) })

export function routes(app: AnyElysia) {
  app
    .get('/repos', async ({ query }) => {
      const owner = typeof query.owner === 'string' && query.owner ? query.owner : undefined
      const repos = await listRepos({ refresh: flagParam(query.refresh), owner })
      return jsonOk(`${repos.length} repos`, { repos })
    })
    .post('/repos', async ({ body, set }) => {
      const repo = await createRepo(bodyOf(body) as CreateRepoInput, ctx)
      set.status = 201
      return jsonOk(`repo ${repo.full_name} created`, { repo })
    })
    .get('/repos/:owner/:name', async ({ params }) => jsonOk('ok', { repo: await getRepo(`${params.owner}/${params.name}`) }))
    .delete('/repos/:owner/:name', async ({ params, body }) => {
      const { confirm } = confirmBody.parse(bodyOf(body))
      const repo = await deleteRepo(`${params.owner}/${params.name}`, confirm, ctx)
      return jsonOk(`repo ${repo.full_name} deleted`, { repo })
    })
    .put('/repos/:owner/:name/sets', async ({ params, body }) => {
      const { sets } = setsBody.parse(bodyOf(body))
      const repo = await assignSets(`${params.owner}/${params.name}`, sets, ctx)
      return jsonOk(`${repo.sets.length} sets assigned to ${repo.full_name}`, { repo })
    })
    .get('/repos/:owner/:name/lookups', async ({ params }) => jsonOk('ok', await repoLookups(`${params.owner}/${params.name}`)))
}
