import { applyTool } from './apply'
import { assignSetsTool } from './assign_sets'
import { auditTool } from './audit'
import { bulkTool } from './bulk'
import { createRepoTool } from './create_repo'
import type { ToolDefinition } from './define'
import { deleteRepoTool } from './delete_repo'
import { deleteSetTool } from './delete_set'
import { deleteTemplateTool } from './delete_template'
import { exportYamlTool } from './export_yaml'
import { getRepoTool } from './get_repo'
import { getRunTool } from './get_run'
import { getSetTool } from './get_set'
import { getSettingsTool } from './get_settings'
import { getTemplateTool } from './get_template'
import { health } from './health'
import { importYamlTool } from './import_yaml'
import { listEventsTool } from './list_events'
import { listReposTool } from './list_repos'
import { listRunsTool } from './list_runs'
import { listSections } from './list_sections'
import { listSetsTool } from './list_sets'
import { listTemplatesTool } from './list_templates'
import { planTool } from './plan'
import { repoLookupsTool } from './repo_lookups'
import { setSettingTool } from './set_setting'
import { upsertSet } from './upsert_set'
import { upsertTemplate } from './upsert_template'

/** Every MCP tool. Adding a tool = one file in this folder + one line here. Names are a stable contract. */
export const tools = [
  health,
  listSections,
  listTemplatesTool,
  getTemplateTool,
  upsertTemplate,
  deleteTemplateTool,
  listSetsTool,
  getSetTool,
  upsertSet,
  deleteSetTool,
  listReposTool,
  getRepoTool,
  assignSetsTool,
  repoLookupsTool,
  planTool,
  applyTool,
  bulkTool,
  auditTool,
  getRunTool,
  listRunsTool,
  listEventsTool,
  exportYamlTool,
  importYamlTool,
  getSettingsTool,
  setSettingTool,
  createRepoTool,
  deleteRepoTool,
] as unknown as ToolDefinition[]

export function findTool(name: string): ToolDefinition | undefined {
  return tools.find((t) => t.name === name)
}
