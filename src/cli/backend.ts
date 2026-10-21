import type { ApplyReport, Plan } from '../engine/types'
import type { Change } from '../sections/types'
import type { Values } from '../templates/values'

/** A plan as both backends return it (the engine Plan, or its JSON from the API). */
export type PlanLike = {
  id: string | null
  repo: { full_name: string }
  changes: Change[]
  skipped: Plan['skipped']
  destructive: number
}
export type ReportLike = Pick<ApplyReport, 'run_id' | 'repo' | 'status' | 'results' | 'skipped' | 'applied' | 'failed'>
export type DriftLike = { repo: string; state: 'clean' | 'drift' | 'error' | string; changes: Change[]; message: string }
export type Target = { sets: string[]; templates: string[]; values: Values }
export type RepoTarget = Target & { repo: string }
export type Listed = { name: string; description: string; builtin?: boolean; detail: string }
export type ImportResult = { stored: boolean; templates: number; sets: number; repos: number }

/** What a command needs; standalone (engine in-process) and server (HTTP API) implement it. */
export interface Backend {
  readonly mode: 'standalone' | 'server'
  sections(): Promise<{ name: string; title: string; description: string }[]>
  templates(): Promise<Listed[]>
  templateYaml(name: string): Promise<string>
  sets(): Promise<Listed[]>
  setYaml(name: string): Promise<string>
  plan(repo: string, target: Target): Promise<PlanLike>
  apply(plan: PlanLike, confirm: string | undefined): Promise<ReportLike>
  /** Repos to sync with their targets (Manifest entries, or the server's assignments). */
  syncTargets(): Promise<RepoTarget[]>
  audit(repos: string[], target: Target): Promise<DriftLike[]>
  exportYaml(opts: { templates: string[]; sets: string[]; manifest: boolean }): Promise<string>
  importYaml(text: string): Promise<ImportResult>
  repos(): Promise<{ full_name: string; visibility: string; sets: { set: string }[]; drift_state: string }[]>
  createRepo(input: { owner?: string; name: string; private: boolean; description?: string; sets: string[] }): Promise<{ full_name: string }>
  deleteRepo(fullName: string, confirm: string): Promise<void>
}

export class CliError extends Error {
  constructor(
    message: string,
    readonly code = 'error',
    readonly data: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'CliError'
  }
}
