import { repoLookups } from '../../services'
import { defineTool } from './define'
import { repo } from './shared'

export const repoLookupsTool = defineTool({
  name: 'repo_lookups',
  description:
    'Names to use in templates for one repo: branches, status check names seen on the default branch (for required checks), team slugs (organizations) and environments.',
  inputSchema: { repo },
  destructive: false,
  readOnly: true,
  handler: async (args) => repoLookups(args.repo),
})
