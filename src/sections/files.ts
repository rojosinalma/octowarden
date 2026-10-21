import { z } from 'zod'
import { BUILTIN_FILE_NAMES, BUILTIN_FILES } from '../templates/files'
import type { RepoInfo } from '../github/repo'
import type { ApplyResult, Change, Section, SectionContext } from './types'
import { notArchived, statusOf } from './util'

export const MAX_FILE_BYTES = 512 * 1024

const path = z
  .string()
  .min(1)
  .max(1024)
  .refine((p) => !p.startsWith('/') && !p.endsWith('/') && p.split('/').every((s) => s !== '' && s !== '.' && s !== '..' && s !== '.git'), 'relative path without . / .. / .git segments')
  .describe('Path in the repo, e.g. `.github/pull_request_template.md`.')

const branchName = z.string().regex(/^(?!\/|.*\/\/|.*\.\.|.*\.lock$)[A-Za-z0-9._\/-]{1,200}$/, 'git branch name')

export const prSchema = z
  .strictObject({
    title: z.string().min(1).max(256).describe('Pull request title.'),
    branch: branchName.describe('Head branch the commit goes to; created from the base branch when missing.'),
    body: z.string().max(10_000).optional().describe('Pull request description.'),
  })
  .describe('Open a pull request instead of committing to the branch directly.')

export const fileSchema = z
  .strictObject({
    path,
    content: z.string().max(MAX_FILE_BYTES).optional().describe('File content (text). `${{ values.* }}` placeholders work.'),
    content_ref: z.enum(BUILTIN_FILE_NAMES).optional().describe('A built-in file body instead of `content`.'),
    mode: z.enum(['create', 'overwrite']).optional().describe('overwrite (default): keep the file equal to the template; create: only add it when missing.'),
    branch: branchName.optional().describe('Target branch (default: the default branch).'),
    pr: prSchema.optional(),
  })
  .refine((f) => (f.content === undefined) !== (f.content_ref === undefined), 'set exactly one of content or content_ref')

const config = z
  .array(fileSchema)
  .max(100)
  .describe('Repository files (PR/issue templates, CODEOWNERS, SECURITY.md, …), committed as one verified commit or opened as a pull request.')

export type FileSpec = z.infer<typeof fileSchema>
export type FilesConfig = z.infer<typeof config>

/** What a files change carries in `after`: everything apply needs. */
export type FileWrite = { path: string; content: string; branch: string; mode: 'create' | 'overwrite'; pr?: z.infer<typeof prSchema> }

type FileState = { sha: string; content?: string } | null | { error: string }
export type FilesCurrent = Record<string, FileState>

const keyOf = (branch: string, p: string) => `${branch}:${p}`

/** Git blob id of a text: equal ids = equal content, without downloading large files. */
export function blobSha(content: string): string {
  const bytes = Buffer.from(content, 'utf8')
  return new Bun.CryptoHasher('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
}

type ContentResponse = { type?: string; sha?: string; content?: string; encoding?: string } | unknown[]

async function readFile(ctx: SectionContext, branch: string, filePath: string): Promise<FileState> {
  try {
    const { data } = await ctx.gh.request<ContentResponse>('GET /repos/{owner}/{repo}/contents/{path}', {
      owner: ctx.repo.owner,
      repo: ctx.repo.name,
      path: filePath,
      ref: branch,
    })
    if (Array.isArray(data) || data.type !== 'file' || !data.sha) return { error: `${filePath} exists and is not a file` }
    const content = data.encoding === 'base64' && data.content !== undefined ? Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8') : undefined
    return { sha: data.sha, content }
  } catch (err) {
    const msg = (err as Error).message
    if (statusOf(err) === 404 && /empty/i.test(msg)) return { error: 'repository is empty: push a first commit' }
    if (statusOf(err) === 404 && /no commit found for the ref/i.test(msg)) return { error: `branch ${branch} does not exist` }
    if (statusOf(err) === 404) return null
    throw err
  }
}

function writeOf(f: FileSpec, repo: RepoInfo): FileWrite {
  return { path: f.path, content: f.content ?? '', branch: f.branch ?? repo.default_branch, mode: f.mode ?? 'overwrite', ...(f.pr ? { pr: f.pr } : {}) }
}

export async function readFiles(ctx: SectionContext, files: FileSpec[]): Promise<FilesCurrent> {
  const out: FilesCurrent = {}
  for (const f of files) {
    const w = writeOf(f, ctx.repo)
    const k = keyOf(w.branch, w.path)
    if (!(k in out)) out[k] = await readFile(ctx, w.branch, w.path)
  }
  return out
}

export function diffFiles(section: string, files: FileSpec[], current: FilesCurrent, repo: RepoInfo): Change[] {
  return files.map((f): Change => {
    const after = writeOf(f, repo)
    const state = current[keyOf(after.branch, after.path)]
    if (state && 'error' in state) return { section, op: 'update', target: f.path, after, destructive: false, skip: state.error }
    if (!state) return { section, op: 'create', target: f.path, after, destructive: false }
    const before = state.content
    const op = after.mode === 'create' || state.sha === blobSha(after.content) ? 'noop' : 'update'
    return { section, op, target: f.path, before, after, destructive: false }
  })
}

const MUTATION = `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid url } }
}`

async function headOid(ctx: SectionContext, branch: string): Promise<string | undefined> {
  try {
    const { data } = await ctx.gh.request<{ object: { sha: string } }>('GET /repos/{owner}/{repo}/git/ref/{ref}', {
      owner: ctx.repo.owner,
      repo: ctx.repo.name,
      ref: `heads/${branch}`,
    })
    return data.object.sha
  } catch (err) {
    if (statusOf(err) === 404) return undefined
    throw err
  }
}

/** One GitHub-signed commit with every file (GraphQL createCommitOnBranch). */
export async function commitFiles(ctx: SectionContext, branch: string, expectedHeadOid: string, files: FileWrite[]): Promise<{ oid: string; url?: string }> {
  const paths = files.map((f) => f.path)
  const headline = `chore: update ${paths.length === 1 ? paths[0] : `${paths.length} files`} from octowarden templates`
  const res = await ctx.gh.graphql<{ createCommitOnBranch: { commit: { oid: string; url?: string } } }>(MUTATION, {
    input: {
      branch: { repositoryNameWithOwner: ctx.repo.full_name, branchName: branch },
      message: { headline, body: paths.map((p) => `- ${p}`).join('\n') },
      expectedHeadOid,
      fileChanges: { additions: files.map((f) => ({ path: f.path, contents: Buffer.from(f.content, 'utf8').toString('base64') })) },
    },
  })
  return res.createCommitOnBranch.commit
}

async function applyGroup(ctx: SectionContext, base: string, pr: FileWrite['pr'], files: FileWrite[]): Promise<string> {
  const params = { owner: ctx.repo.owner, repo: ctx.repo.name }
  const baseHead = await headOid(ctx, base)
  if (!baseHead) throw new Error(`branch ${base} does not exist`)
  if (!pr) {
    const c = await commitFiles(ctx, base, baseHead, files)
    return `committed ${c.oid.slice(0, 7)} to ${base}`
  }
  let head = await headOid(ctx, pr.branch)
  let pending = files
  if (!head) {
    await ctx.gh.request('POST /repos/{owner}/{repo}/git/refs', { ...params, ref: `refs/heads/${pr.branch}`, sha: baseHead })
    head = baseHead
  } else {
    // The branch is left from an earlier apply: commit only what still differs there.
    pending = []
    for (const f of files) {
      const s = await readFile(ctx, pr.branch, f.path)
      if (!s || 'error' in s || s.sha !== blobSha(f.content)) pending.push(f)
    }
  }
  const committed = pending.length ? await commitFiles(ctx, pr.branch, head, pending) : undefined
  const { data: open } = await ctx.gh.request<{ number: number }[]>('GET /repos/{owner}/{repo}/pulls', {
    ...params,
    head: `${ctx.repo.owner}:${pr.branch}`,
    base,
    state: 'open',
  })
  const note = committed ? `committed ${committed.oid.slice(0, 7)} to ${pr.branch}, ` : ''
  if (Array.isArray(open) && open[0]) return `${note}PR #${open[0].number} open`
  const { data } = await ctx.gh.request<{ number: number; html_url?: string }>('POST /repos/{owner}/{repo}/pulls', {
    ...params,
    title: pr.title,
    head: pr.branch,
    base,
    ...(pr.body ? { body: pr.body } : {}),
  })
  return `${note}PR #${data.number} opened`
}

/** Groups writes by target (branch, PR branch): one commit per group, so normally one per apply. */
export async function applyFiles(ctx: SectionContext, changes: Change[]): Promise<ApplyResult[]> {
  const groups = new Map<string, Change[]>()
  for (const c of changes) {
    const w = c.after as FileWrite
    const k = `${w.branch}\0${w.pr?.branch ?? ''}`
    groups.set(k, [...(groups.get(k) ?? []), c])
  }
  const results: ApplyResult[] = []
  for (const group of groups.values()) {
    const first = group[0]!.after as FileWrite
    const pr = group.map((c) => (c.after as FileWrite).pr).find(Boolean)
    try {
      const message = await applyGroup(ctx, first.branch, pr, group.map((c) => c.after as FileWrite))
      for (const change of group) results.push({ change, outcome: 'applied', message })
    } catch (err) {
      for (const change of group) results.push({ change, outcome: 'failed', message: (err as Error).message })
    }
  }
  return results
}

/** Replaces `content_ref` with the built-in body before values substitution. */
export function expandFiles(raw: unknown): unknown {
  if (!Array.isArray(raw)) return raw
  return raw.map((item) => {
    if (!item || typeof item !== 'object') return item
    const { content_ref, ...rest } = item as Record<string, unknown>
    if (typeof content_ref !== 'string' || !Object.hasOwn(BUILTIN_FILES, content_ref) || rest.content !== undefined) return item
    return { ...rest, content: BUILTIN_FILES[content_ref] }
  })
}

/** Repo files via verified GraphQL commits; never deletes files. */
export const files: Section<FilesConfig, FilesCurrent> = {
  name: 'files',
  title: 'Files',
  description: config.description!,
  schema: config,
  mergeKey: 'path',
  expand: expandFiles,
  read: (ctx, desired) => readFiles(ctx, desired ?? []),
  diff: (desired, current, repo) => diffFiles('files', desired, current, repo),
  apply: applyFiles,
  supports: notArchived,
}
