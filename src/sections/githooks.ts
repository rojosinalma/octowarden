import { z } from 'zod'
import { applyFiles, diffFiles, MAX_FILE_BYTES, readFiles, type FileSpec, type FilesCurrent } from './files'
import type { Section } from './types'
import { notArchived } from './util'

/** Client-side hooks git runs from `core.hooksPath`. */
export const HOOKS = [
  'applypatch-msg',
  'pre-applypatch',
  'post-applypatch',
  'pre-commit',
  'pre-merge-commit',
  'prepare-commit-msg',
  'commit-msg',
  'post-commit',
  'pre-rebase',
  'post-checkout',
  'post-merge',
  'pre-push',
  'post-rewrite',
  'pre-auto-gc',
] as const

export const HOOKS_DIR = '.githooks'

const script = z.string().min(1).max(MAX_FILE_BYTES)

const config = z
  .strictObject({
    ...Object.fromEntries(HOOKS.map((h) => [h, script.optional().describe(`Script for the ${h} hook (start with a shebang).`)])),
    readme: z.boolean().optional().describe(`Also write ${HOOKS_DIR}/README.md with the one-time setup (default true).`),
  })
  .describe(`Git hook scripts delivered as files under ${HOOKS_DIR}/, committed together with the files section.`)

export type GithooksConfig = Partial<Record<(typeof HOOKS)[number], string>> & { readme?: boolean }

export const README = `# Git hooks

The scripts in this folder are git hooks shared by everyone who works on this repository.
They are managed from a template: change the template, not these files.

Turn them on once per clone:

    git config core.hooksPath ${HOOKS_DIR}

Git runs a hook only when its file is executable. Commits made through the GitHub API cannot set the
executable bit, so mark new hooks once and commit that change (later updates keep the bit):

    git update-index --chmod=+x ${HOOKS_DIR}/<hook>
`

/** The hooks as files-section entries (overwrite, default branch). */
export function hookFiles(cfg: GithooksConfig): FileSpec[] {
  const out: FileSpec[] = []
  for (const h of HOOKS) {
    const body = cfg[h]
    if (body !== undefined) out.push({ path: `${HOOKS_DIR}/${h}`, content: body.endsWith('\n') ? body : `${body}\n`, mode: 'overwrite' })
  }
  if (out.length && cfg.readme !== false) out.push({ path: `${HOOKS_DIR}/README.md`, content: README, mode: 'overwrite' })
  return out
}

/** Git hooks: a thin layer over the files section; the engine applies both in one commit (`applyWith`). */
export const githooks: Section<GithooksConfig, FilesCurrent> = {
  name: 'githooks',
  title: 'Git hooks',
  description: config.description!,
  schema: config as unknown as z.ZodType<GithooksConfig>,
  applyWith: 'files',
  read: (ctx, desired) => readFiles(ctx, hookFiles(desired ?? {})),
  diff: (desired, current, repo) => diffFiles('githooks', hookFiles(desired), current, repo),
  apply: applyFiles,
  supports: notArchived,
}
