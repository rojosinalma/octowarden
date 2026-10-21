import { describe, expect, test } from 'bun:test'
import type { FakeGitHub } from '../../src/github/fake'
import { blobSha, expandFiles, files, type FilesConfig } from '../../src/sections/files'
import { githooks, README } from '../../src/sections/githooks'
import { BUILTIN_FILES } from '../../src/templates/files'
import { ctxOf, fakeGitHub, fixture, notFound, OWNER, repo, writes } from './helpers'

const HEAD = '1111111111111111111111111111111111111111'
const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64')

async function world(opts: { branches?: Record<string, string>; contents?: Record<string, string>; openPr?: number } = {}) {
  const gh = fakeGitHub()
  const security = await fixture('files/contents-SECURITY.md')
  const branches: Record<string, string> = { main: HEAD, ...opts.branches }
  const contents: Record<string, string> = opts.contents ?? {}
  gh.on('GET /repos/{owner}/{repo}/contents/{path}', (p) => {
    const key = `${p.ref}:${p.path}`
    if (contents[key] !== undefined) return { type: 'file', encoding: 'base64', sha: blobSha(contents[key]!), content: b64(contents[key]!) }
    if (p.path === 'SECURITY.md' && p.ref === 'main') return security
    if (!branches[String(p.ref)]) return notFound(`No commit found for the ref ${p.ref}`)
    return notFound()
  })
  gh.on('GET /repos/{owner}/{repo}/git/ref/{ref}', async (p) => {
    const b = String(p.ref).replace(/^heads\//, '')
    if (!branches[b]) return notFound()
    const ref = await fixture('files/ref-main')
    ref.object.sha = branches[b]
    return ref
  })
  gh.on('POST /repos/{owner}/{repo}/git/refs', () => ({}))
  gh.on('GET /repos/{owner}/{repo}/pulls', () => (opts.openPr ? [{ number: opts.openPr }] : []))
  gh.on('POST /repos/{owner}/{repo}/pulls', () => fixture('files/pull-created'))
  const commit = await fixture('files/createCommitOnBranch')
  gh.onGraphql(() => commit)
  return gh
}

const graphqlCalls = (gh: FakeGitHub) => gh.calls.filter((c) => c.route === 'POST /graphql')

describe('files section', () => {
  test('diff: create when missing, update by blob sha, noop when equal, mode create never overwrites', async () => {
    const gh = await world({ contents: { 'main:README.md': 'same\n' } })
    const desired: FilesConfig = [
      { path: '.github/pull_request_template.md', content: 'PR\n' },
      { path: 'SECURITY.md', content: '# Security policy\n\nNew text.\n' },
      { path: 'README.md', content: 'same\n' },
    ]
    const changes = files.diff(desired, await files.read(ctxOf(gh), desired), repo)
    expect(changes.map((c) => [c.target, c.op, c.destructive])).toEqual([
      ['.github/pull_request_template.md', 'create', false],
      ['SECURITY.md', 'update', false],
      ['README.md', 'noop', false],
    ])
    expect(changes[1]!.before).toBe('# Security policy\n\nOld text.\n')
    const createOnly: FilesConfig = [{ path: 'SECURITY.md', content: 'different', mode: 'create' }]
    expect(files.diff(createOnly, await files.read(ctxOf(gh), createOnly), repo)[0]!.op).toBe('noop')
  })

  test('blobSha matches the git blob id in the recorded contents answer', async () => {
    const security = await fixture('files/contents-SECURITY.md')
    expect(blobSha('# Security policy\n\nOld text.\n')).toBe(security.sha)
  })

  test('apply: one createCommitOnBranch with every file and expectedHeadOid', async () => {
    const gh = await world()
    const desired: FilesConfig = [
      { path: '.github/pull_request_template.md', content: 'PR ✓\n' },
      { path: 'SECURITY.md', content: 'new\n' },
    ]
    const changes = files.diff(desired, await files.read(ctxOf(gh), desired), repo)
    gh.calls.length = 0
    const results = await files.apply(ctxOf(gh, repo, false), changes)
    expect(results.map((r) => [r.outcome, r.message])).toEqual([
      ['applied', 'committed 2222222 to main'],
      ['applied', 'committed 2222222 to main'],
    ])
    const [call] = graphqlCalls(gh)
    expect(graphqlCalls(gh)).toHaveLength(1)
    expect(call!.params.query).toContain('createCommitOnBranch(input: $input)')
    expect(call!.params.input).toEqual({
      branch: { repositoryNameWithOwner: 'octo-example/demo', branchName: 'main' },
      message: { headline: 'chore: update 2 files from octowarden templates', body: '- .github/pull_request_template.md\n- SECURITY.md' },
      expectedHeadOid: HEAD,
      fileChanges: {
        additions: [
          { path: '.github/pull_request_template.md', contents: b64('PR ✓\n') },
          { path: 'SECURITY.md', contents: b64('new\n') },
        ],
      },
    })
    expect(gh.calls.map((c) => c.route)).toEqual(['GET /repos/{owner}/{repo}/git/ref/{ref}', 'POST /graphql'])
  })

  test('pr mode: creates the branch from the base head, commits there, opens the PR', async () => {
    const gh = await world()
    const pr = { title: 'Add repository files', branch: 'octowarden/files' }
    const desired: FilesConfig = [{ path: 'CODEOWNERS', content: '* @octo-example\n', pr }]
    const changes = files.diff(desired, await files.read(ctxOf(gh), desired), repo)
    gh.calls.length = 0
    const [r] = await files.apply(ctxOf(gh, repo, false), changes)
    expect(r!.message).toBe('committed 2222222 to octowarden/files, PR #7 opened')
    expect(writes(gh).map((c) => [c.route, c.route === 'POST /graphql' ? (c.params.input as any).branch.branchName : c.params])).toEqual([
      ['POST /repos/{owner}/{repo}/git/refs', { ...OWNER, ref: 'refs/heads/octowarden/files', sha: HEAD }],
      ['POST /graphql', 'octowarden/files'],
      ['POST /repos/{owner}/{repo}/pulls', { ...OWNER, title: pr.title, head: 'octowarden/files', base: 'main' }],
    ])
    expect(gh.calls.find((c) => c.route === 'GET /repos/{owner}/{repo}/pulls')!.params).toEqual({ ...OWNER, head: 'octo-example:octowarden/files', base: 'main', state: 'open' })
  })

  test('pr mode on a branch left from an earlier apply: no empty commit, existing PR reused', async () => {
    const gh = await world({ branches: { 'octowarden/files': '3333333333333333333333333333333333333333' }, contents: { 'octowarden/files:CODEOWNERS': '* @octo-example\n' }, openPr: 5 })
    const desired: FilesConfig = [{ path: 'CODEOWNERS', content: '* @octo-example\n', pr: { title: 't', branch: 'octowarden/files' } }]
    const changes = files.diff(desired, await files.read(ctxOf(gh), desired), repo)
    expect(changes[0]!.op).toBe('create') // missing on the base branch until the PR merges
    gh.calls.length = 0
    const [r] = await files.apply(ctxOf(gh, repo, false), changes)
    expect(r!.message).toBe('PR #5 open')
    expect(writes(gh)).toEqual([])
  })

  test('a missing target branch is a skip with the reason', async () => {
    const gh = await world()
    const desired: FilesConfig = [{ path: 'x.md', content: 'x', branch: 'nope' }]
    const [c] = files.diff(desired, await files.read(ctxOf(gh), desired), repo)
    expect(c!.skip).toBe('branch nope does not exist')
  })

  test('a failing commit fails every change of that commit', async () => {
    const gh = await world()
    gh.onGraphql(() => {
      throw new Error('Expected branch to point to "1111" but it did not')
    })
    const desired: FilesConfig = [{ path: 'a', content: 'a' }, { path: 'b', content: 'b' }]
    const results = await files.apply(ctxOf(gh, repo, false), files.diff(desired, await files.read(ctxOf(gh), desired), repo))
    expect(results.map((r) => r.outcome)).toEqual(['failed', 'failed'])
  })

  test('expand: content_ref becomes the built-in body; schema needs exactly one of content/content_ref; paths are safe', () => {
    expect(expandFiles([{ path: 'SECURITY.md', content_ref: 'SECURITY.md', mode: 'create' }])).toEqual([
      { path: 'SECURITY.md', content: BUILTIN_FILES['SECURITY.md'], mode: 'create' },
    ])
    expect(files.schema.safeParse([{ path: 'a', content_ref: 'SECURITY.md' }]).success).toBe(true)
    expect(files.schema.safeParse([{ path: 'a', content_ref: 'nope.md' }]).success).toBe(false)
    expect(files.schema.safeParse([{ path: 'a' }]).success).toBe(false)
    expect(files.schema.safeParse([{ path: 'a', content: 'x', content_ref: 'SECURITY.md' }]).success).toBe(false)
    for (const bad of ['/etc/passwd', '../x', 'a/../b', '.git/config', 'a//b']) expect(files.schema.safeParse([{ path: bad, content: 'x' }]).success).toBe(false)
  })
})

describe('githooks section', () => {
  test('hooks become .githooks/<hook> files plus the README; changes keep section githooks', async () => {
    const gh = await world()
    const desired = { 'pre-commit': '#!/bin/sh\nbun test', 'commit-msg': '#!/bin/sh\nexit 0\n' }
    const changes = githooks.diff(desired, await githooks.read(ctxOf(gh), desired), repo)
    expect(changes.map((c) => [c.section, c.target, c.op])).toEqual([
      ['githooks', '.githooks/pre-commit', 'create'],
      ['githooks', '.githooks/commit-msg', 'create'],
      ['githooks', '.githooks/README.md', 'create'],
    ])
    expect((changes[0]!.after as { content: string }).content).toBe('#!/bin/sh\nbun test\n')
    expect((changes[2]!.after as { content: string }).content).toBe(README)
    expect(githooks.diff({ 'pre-push': 'x', readme: false }, {}, repo).map((c) => c.target)).toEqual(['.githooks/pre-push'])
    expect(githooks.applyWith).toBe('files')
  })

  test('schema: only known hook names', () => {
    expect(githooks.schema.safeParse({ 'pre-commit': '#!/bin/sh' }).success).toBe(true)
    expect(githooks.schema.safeParse({ 'pre-anything': '#!/bin/sh' }).success).toBe(false)
  })
})
