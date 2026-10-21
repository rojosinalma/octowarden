import { deleteRepo } from '../../services'
import { defineTool } from './define'
import { confirm, repo } from './shared'

export const deleteRepoTool = defineTool({
  name: 'delete_repo',
  description:
    'Delete a repository on GitHub. Irreversible and destructive: needs confirm equal to the repo full name ("owner/name"). The deletion is recorded in the audit trail.',
  inputSchema: { repo, confirm },
  destructive: true,
  readOnly: false,
  handler: async (args, ctx) => ({ repo: await deleteRepo(args.repo, args.confirm, ctx) }),
})
