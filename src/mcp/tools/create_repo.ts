import { z } from 'zod'
import { createRepo } from '../../services'
import { defineTool } from './define'
import { values } from './shared'

export const createRepoTool = defineTool({
  name: 'create_repo',
  description:
    'Create a repository on GitHub, under owner (an organization, or the token\'s user; default the default_owner setting). ' +
    'Optional sets are assigned (not applied: run plan/apply next). Returns the repo.',
  inputSchema: {
    name: z.string(),
    private: z.boolean(),
    owner: z.string().optional(),
    description: z.string().optional(),
    sets: z.array(z.object({ set: z.string(), values: values.optional() })).optional(),
  },
  destructive: false,
  readOnly: false,
  handler: async (args, ctx) => ({ repo: await createRepo(args, ctx) }),
})
