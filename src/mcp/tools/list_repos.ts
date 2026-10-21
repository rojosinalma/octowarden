import { z } from 'zod'
import { listRepos } from '../../services'
import { defineTool } from './define'

export const listReposTool = defineTool({
  name: 'list_repos',
  description:
    'Known repos with visibility, default branch, assigned sets, drift_state (clean|drift|error|unknown) and last audit. ' +
    'refresh: true re-reads the list from GitHub first; owner filters by owner.',
  inputSchema: { refresh: z.boolean().optional(), owner: z.string().optional() },
  destructive: false,
  readOnly: true,
  handler: async (args) => ({ repos: await listRepos(args) }),
})
