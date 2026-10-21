import { describe, expect, test } from 'bun:test'
import { apply, plan } from '../../src/engine'
import { fakeError } from '../../src/github/fake'
import { ValidationError } from '../../src/lib/json'
import { getSection } from '../../src/sections'
import { blobSha } from '../../src/sections/files'
import { BUILTIN_YAML, builtinDocs, builtinLibrary, isBuiltin, layeredLibrary } from '../../src/templates/builtin'
import { memoryLibrary } from '../../src/templates/library'
import { parseYaml } from '../../src/templates/schema'
import { fakeGitHub, fixture, notFound } from './helpers'

const ORIGIN = { source: 'cli' as const, actor: 'test', record: false }
const REPO = 'octo-example/demo'
const HEAD = '1111111111111111111111111111111111111111'

async function world(repoOverrides: Record<string, unknown> = {}) {
  const gh = fakeGitHub({ ...(await fixture('security/security_and_analysis')), ...repoOverrides })
  gh.on('PATCH /repos/{owner}/{repo}', () => ({}))
  gh.on('GET /repos/{owner}/{repo}/contents/{path}', () => notFound())
  gh.on('GET /repos/{owner}/{repo}/git/ref/{ref}', () => ({ object: { sha: HEAD } }))
  gh.onGraphql(async () => fixture('files/createCommitOnBranch'))
  gh.on('GET /repos/{owner}/{repo}/vulnerability-alerts', () => notFound())
  gh.on('GET /repos/{owner}/{repo}/automated-security-fixes', () => ({ enabled: false }))
  gh.on('GET /repos/{owner}/{repo}/private-vulnerability-reporting', () => ({ enabled: false }))
  gh.on('GET /repos/{owner}/{repo}/rulesets', () => [])
  return gh
}

describe('built-in starter templates', () => {
  test('every document parses, uses only registered sections, and the house set resolves', async () => {
    const docs = builtinDocs()
    expect(docs.map((d) => `${d.kind}:${d.metadata?.name}`)).toEqual([
      'Template:base',
      'Template:security',
      'Template:protect-main',
      'Template:protect-dev',
      'Template:oss',
      'Template:fork',
      'Set:house',
    ])
    for (const d of docs) if (d.kind === 'Template') for (const s of Object.keys(d.spec.sections)) expect(getSection(s)).toBeDefined()
    const lib = builtinLibrary()
    const house = await lib.getSet('house')
    expect(house).toMatchObject({ templates: ['base', 'security', 'protect-main'], values: { required_checks: 'check' } })
    for (const t of house!.templates) expect(await lib.getTemplate(t)).toBeDefined()
    expect(isBuiltin('house', 'Set')).toBe(true)
    expect(isBuiltin('house', 'Template')).toBe(false)
    expect(Object.keys(BUILTIN_YAML)).toHaveLength(7)
  })

  test('layeredLibrary: the first library that knows a name wins', async () => {
    const mine = memoryLibrary(parseYaml('apiVersion: octowarden/v1\nkind: Template\nmetadata: {name: base, description: mine}\nspec: {sections: {settings: {has_wiki: true}}}'))
    const lib = layeredLibrary(mine, builtinLibrary())
    expect((await lib.getTemplate('base'))?.description).toBe('mine')
    expect((await lib.getTemplate('fork'))?.name).toBe('fork')
    expect(await lib.getTemplate('nope')).toBeUndefined()
  })

  test('oss: content_ref bodies are expanded and their placeholders filled from implicit repo values', async () => {
    const gh = await world()
    const p = await plan({ repo: REPO, templates: ['oss'], library: builtinLibrary(), gh, ...ORIGIN })
    const files = p.desired.files as { path: string; content: string }[]
    const codeowners = files.find((f) => f.path === '.github/CODEOWNERS')!
    expect(codeowners.content).toContain('* @octo-example\n')
    expect(files.find((f) => f.path === 'SECURITY.md')!.content).toContain('https://github.com/octo-example/demo/security/advisories/new')
    expect(JSON.stringify(p.desired)).not.toContain('${{')
    expect(p.changes.filter((c) => c.section === 'files')).toHaveLength(6)
    // the recorded repo already has discussions on
    expect(p.sections.find((s) => s.section === 'settings')).toEqual({ section: 'settings', changes: 0, noop: 1 })
  })

  test('protect-main without required_checks names the missing value; the house set supplies it', async () => {
    const gh = await world()
    await expect(plan({ repo: REPO, templates: ['protect-main'], library: builtinLibrary(), gh, ...ORIGIN })).rejects.toThrow(ValidationError)
    const p = await plan({ repo: REPO, sets: ['house'], library: builtinLibrary(), gh, ...ORIGIN })
    const rs = p.changes.find((c) => c.section === 'rulesets')!
    expect(rs).toMatchObject({ op: 'create', target: 'protect-main' })
    expect(JSON.stringify(rs.after)).toContain('"context":"check"')
  })

  test('house on a private Free repo: rulesets skipped by the 403, secret scanning and PVR skipped per target', async () => {
    const gh = await world({ private: true, visibility: 'private' })
    const limit = await fixture('rulesets/plan-limit-403')
    gh.on('GET /repos/{owner}/{repo}/rulesets', () => {
      throw fakeError(403, limit.message)
    })
    const p = await plan({ repo: REPO, sets: ['house'], library: builtinLibrary(), gh, ...ORIGIN })
    expect(p.skipped).toEqual([
      { section: 'security', target: 'secret_scanning_push_protection', reason: 'secret scanning on a private repository needs GitHub Secret Protection (Advanced Security)' },
      { section: 'security', target: 'private_vulnerability_reporting', reason: 'private vulnerability reporting is only available on public repositories' },
      { section: 'rulesets', reason: limit.message },
    ])
    expect(p.changes.some((c) => c.skip)).toBe(false)
    expect(p.sections.find((s) => s.section === 'rulesets')?.skipped).toBe(limit.message)
  })
})

describe('engine with files + githooks', () => {
  const lib = memoryLibrary(
    parseYaml(`apiVersion: octowarden/v1
kind: Template
metadata: {name: hooks}
spec:
  sections:
    files:
      - path: NOTICE
        content: "Copyright \${{ values.owner }}\\n"
    githooks:
      pre-commit: "#!/bin/sh\\nbun test\\n"
      readme: false
`),
  )

  test('files and githooks changes go out in one commit; events keep their own section', async () => {
    const gh = await world()
    const p = await plan({ repo: REPO, templates: ['hooks'], library: lib, gh, ...ORIGIN })
    expect(p.changes.map((c) => [c.section, c.target])).toEqual([
      ['files', 'NOTICE'],
      ['githooks', '.githooks/pre-commit'],
    ])
    const report = await apply(p, { source: 'cli', actor: 'test', gh, record: false })
    expect(report.status).toBe('ok')
    expect(report.results.map((r) => [r.change.section, r.outcome])).toEqual([
      ['files', 'applied'],
      ['githooks', 'applied'],
    ])
    const commits = gh.calls.filter((c) => c.route === 'POST /graphql')
    expect(commits).toHaveLength(1)
    const additions = (commits[0]!.params.input as { fileChanges: { additions: { path: string; contents: string }[] } }).fileChanges.additions
    expect(additions.map((a) => a.path)).toEqual(['NOTICE', '.githooks/pre-commit'])
    expect(Buffer.from(additions[0]!.contents, 'base64').toString()).toBe('Copyright octo-example\n')
  })

  test('a second plan after the commit is clean (blob sha comparison)', async () => {
    const gh = await world()
    const stored: Record<string, string> = { NOTICE: 'Copyright octo-example\n', '.githooks/pre-commit': '#!/bin/sh\nbun test\n' }
    gh.on('GET /repos/{owner}/{repo}/contents/{path}', (p) => ({ type: 'file', sha: blobSha(stored[String(p.path)]!), encoding: 'none', content: '' }))
    const p = await plan({ repo: REPO, templates: ['hooks'], library: lib, gh, ...ORIGIN })
    expect(p.changes).toEqual([])
    expect(p.sections).toEqual([
      { section: 'files', changes: 0, noop: 1 },
      { section: 'githooks', changes: 0, noop: 1 },
    ])
  })
})
