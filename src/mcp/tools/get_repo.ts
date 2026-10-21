import { getRepo } from '../../services'
import { defineTool } from './define'
import { repo } from './shared'

export const getRepoTool = defineTool({
  name: 'get_repo',
  description: 'One repo: metadata, assigned sets with per-repo values, drift state and summary, and its last 20 audit events.',
  inputSchema: { repo },
  destructive: false,
  readOnly: true,
  handler: async (args) => ({ repo: await getRepo(args.repo) }),
})
