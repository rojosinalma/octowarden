/**
 * The one service layer the JSON API, MCP and the UI call. Every function validates its own input
 * (zod) and throws the AppError family (422/404/409/503). `ctx` names the interface and actor for the audit trail.
 */
export { API_CTX, MCP_CTX, SCHEDULER_CTX, requireConfirm, uiActor, uiCtx, type Ctx } from './context'
export { serverLibrary, builtinDocuments } from './library'
export { listTemplates, getTemplate, saveTemplate, deleteTemplate, type TemplateInfo, type TemplateDetail } from './templates'
export { listSets, getSet, saveSet, deleteSet, type SetInfo, type SetDetail } from './sets'
export {
  listRepos,
  refreshRepos,
  getRepo,
  assignSets,
  createRepo,
  deleteRepo,
  repoLookups,
  type RepoRow,
  type RepoDetail,
  type RepoLookups,
  type RepoSetAssignment,
  type CreateRepoInput,
} from './repos'
export { createPlan, getPlan, applyPlan, planAndApply, planRequestSchema, type PlanRequest } from './plans'
export { startBulk, startAudit, assignedRepos, activeBulkRuns, drainBulk, waitForBulk, isBulkRun, DESTRUCTIVE_SKIP, type BulkRequest, type BulkMode, type BulkRepoResult } from './bulk'
export { listRuns, getRun, listEvents, SOURCES, OUTCOMES, type EventQuery, type Event, type Run } from './runs'
export { exportYaml, importYaml, type ExportRequest, type ImportCounts } from './portability'
export { listSettings, updateSettings, type PublicSettings } from './settings'
export { listSectionInfo, type SectionInfo } from './sections'
export type { Plan, ApplyReport } from '../engine/types'
