import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseCli, parseValue, UsageError } from '../../src/cli/args'
import { main, type Io } from '../../src/cli/index'
import { createFakeGitHub, type FakeGitHub } from '../../src/github/fake'
import repoFixture from '../fixtures/repo.json'

const REPO = repoFixture.full_name
const dir = mkdtempSync(join(tmpdir(), 'octowarden-cli-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const write = (name: string, text: string) => {
  const path = join(dir, name)
  writeFileSync(path, text)
  return path
}
const template = (name: string, settings: Record<string, unknown>) =>
  `apiVersion: octowarden/v1\nkind: Template\nmetadata:\n  name: ${name}\nspec:\n  sections:\n    settings:\n${Object.entries(settings)
    .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)
    .join('\n')}\n`

// The fixture has has_wiki false and has_issues true.
const DRIFTING = write('drifting.yaml', template('wiki-on', { has_wiki: true }))
const MATCHING = write('matching.yaml', template('wiki-off', { has_wiki: false, has_issues: true }))
const MANIFEST = write(
  'manifest.yaml',
  `${template('wiki-on', { has_wiki: true })}---\napiVersion: octowarden/v1\nkind: Manifest\nspec:\n  repos:\n    - repo: ${REPO}\n      sets: [one]\n---\napiVersion: octowarden/v1\nkind: Set\nmetadata:\n  name: one\nspec:\n  templates: [wiki-on]\n`,
)

let github: FakeGitHub
let patched: Record<string, unknown>[]

beforeEach(() => {
  github = createFakeGitHub()
  patched = []
  const repo: Record<string, unknown> = structuredClone(repoFixture)
  github.on('GET /repos/{owner}/{repo}', () => repo)
  github.on('PATCH /repos/{owner}/{repo}', (params) => {
    const { owner: _o, repo: _r, ...body } = params
    patched.push(body)
    Object.assign(repo, body)
    return repo
  })
})

type Run = { code: number; stdout: string; stderr: string; calls: { url: string; init?: RequestInit }[] }

async function run(argv: string[], opts: { tty?: boolean; env?: Record<string, string>; answer?: string; fetch?: (url: string, init?: RequestInit) => Response } = {}): Promise<Run> {
  let stdout = ''
  let stderr = ''
  const calls: Run['calls'] = []
  const io: Io = {
    stdout: (t) => void (stdout += t),
    stderr: (t) => void (stderr += t),
    isTTY: opts.tty ?? false,
    env: { ...(opts.env ?? {}) },
    fetch: async (url, init) => {
      calls.push({ url, init })
      if (!opts.fetch) throw new Error('no network in tests')
      return opts.fetch(url, init)
    },
    prompt: async () => opts.answer ?? null,
    prog: 'octowarden',
    github: { gh: github, actor: 'tester' },
  }
  const code = await main(argv, io)
  return { code, stdout, stderr, calls }
}

describe('argument parsing', () => {
  test('flags, repeatable options and typed values', () => {
    const a = parseCli(['plan', 'acme/api', '-s', 'house', '--set', 'extra', '-t', 'base', '--value', 'n=3', '--value', 'on=true', '--value', 's=a,b', '--json', '-y', '--confirm', 'acme/api'])
    expect(a).toMatchObject({ command: 'plan', rest: ['acme/api'], sets: ['house', 'extra'], templates: ['base'], json: true, yes: true, confirm: 'acme/api' })
    expect(a.values).toEqual({ n: 3, on: true, s: 'a,b' })
  })
  test('bad input is a usage error', () => {
    expect(() => parseCli(['plan', '--nope'])).toThrow(UsageError)
    expect(() => parseCli(['frobnicate'])).toThrow('unknown command')
    expect(() => parseValue('novalue')).toThrow('key=value')
    expect(() => parseValue('9x=1')).toThrow('value key')
    expect(() => parseCli(['repos', 'create', '--private', '--public'])).toThrow('exclude')
  })
  test('main: usage errors exit 1, --help and --version exit 0', async () => {
    expect((await run(['plan', '--nope'])).code).toBe(1)
    const help = await run(['--help'])
    expect(help.code).toBe(0)
    expect(help.stdout).toContain('Exit codes:')
    expect((await run([])).code).toBe(1)
    expect((await run(['--version'])).stdout.trim()).toMatch(/^\d+\.\d+\.\d+/)
    expect((await run(['plan', '--nope', '--json'])).stdout).toContain('"code":"usage"')
  })
})

describe('standalone', () => {
  test('plan exits 2 when changes are pending and 0 when none', async () => {
    const drift = await run(['plan', REPO, '-f', DRIFTING, '-t', 'wiki-on'])
    expect(drift.code).toBe(2)
    expect(drift.stdout).toContain('~ settings has_wiki')
    const clean = await run(['plan', REPO, '-f', MATCHING, '-t', 'wiki-off'])
    expect(clean.code).toBe(0)
    expect(clean.stdout).toContain('in sync')
    expect(patched).toEqual([])
  })

  test('--json prints exactly one JSON document', async () => {
    const r = await run(['plan', REPO, '-f', DRIFTING, '-t', 'wiki-on', '--json'])
    expect(r.code).toBe(2)
    const body = JSON.parse(r.stdout)
    expect(body.ok).toBe(true)
    expect(body.plan.repo.full_name).toBe(REPO)
    expect(body.plan.changes).toEqual([expect.objectContaining({ section: 'settings', op: 'update', target: 'has_wiki', before: false, after: true })])
    expect(r.stderr).toBe('')
  })

  test('built-in templates work without files; -d reads a directory', async () => {
    const r = await run(['plan', REPO, '-t', 'fork', '--json'])
    expect([0, 2]).toContain(r.code)
    expect(JSON.parse(r.stdout).plan.templates).toEqual(['fork'])
    const d = await run(['templates', '--json', '-d', dir])
    const names = JSON.parse(d.stdout).templates.map((t: { name: string }) => t.name)
    expect(names).toContain('wiki-on')
    expect(names).toContain('base')
  })

  test('apply refuses without a terminal unless --yes', async () => {
    const r = await run(['apply', REPO, '-f', DRIFTING, '-t', 'wiki-on'])
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('--yes')
    expect(patched).toEqual([])
    const ok = await run(['apply', REPO, '-f', DRIFTING, '-t', 'wiki-on', '--yes'])
    expect(ok.code).toBe(0)
    expect(patched).toEqual([{ has_wiki: true }])
  })

  test('apply on a terminal asks and honours the answer', async () => {
    const no = await run(['apply', REPO, '-f', DRIFTING, '-t', 'wiki-on'], { tty: true, answer: 'n' })
    expect(no.code).toBe(1)
    expect(patched).toEqual([])
    const yes = await run(['apply', REPO, '-f', DRIFTING, '-t', 'wiki-on'], { tty: true, answer: 'y' })
    expect(yes.code).toBe(0)
    expect(patched.length).toBe(1)
  })

  test('sync and audit use the Manifest', async () => {
    const audit = await run(['audit', '-f', MANIFEST, '--json'])
    expect(audit.code).toBe(2)
    expect(JSON.parse(audit.stdout).drifts[0]).toMatchObject({ repo: REPO, state: 'drift' })
    const sync = await run(['sync', '-f', MANIFEST, '--yes', '--json'])
    expect(sync.code).toBe(0)
    expect(JSON.parse(sync.stdout)).toMatchObject({ ok: true, failures: [] })
    expect(patched).toEqual([{ has_wiki: true }])
    expect((await run(['audit', '-f', MANIFEST])).code).toBe(0)
  })

  test('a repo without sets or a Manifest entry is an error with the reason', async () => {
    const r = await run(['plan', REPO, '--json'])
    expect(r.code).toBe(1)
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, code: 'invalid' })
  })

  test('import checks only; repos needs a server', async () => {
    const r = await run(['import', MANIFEST])
    expect(r.code).toBe(0)
    expect(r.stdout).toContain('checked only')
    const repos = await run(['repos', 'list'])
    expect(repos.code).toBe(1)
    expect(repos.stderr).toContain('--server')
  })

  test('colours: off on a pipe and with NO_COLOR, on with FORCE_COLOR', async () => {
    const plain = await run(['plan', REPO, '-f', DRIFTING, '-t', 'wiki-on'])
    expect(plain.stdout).not.toContain('\x1b[')
    const forced = await run(['plan', REPO, '-f', DRIFTING, '-t', 'wiki-on'], { env: { FORCE_COLOR: '1' } })
    expect(forced.stdout).toContain('\x1b[')
    const tty = await run(['plan', REPO, '-f', DRIFTING, '-t', 'wiki-on'], { tty: true, env: { NO_COLOR: '1', FORCE_COLOR: '1' } })
    expect(tty.stdout).not.toContain('\x1b[')
  })
})

describe('server mode', () => {
  const SERVER = { OCTOWARDEN_SERVER: 'https://ow.example.test', OCTOWARDEN_TOKEN: 'tok' }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  const plan = (destructive = 0) => ({
    id: 'p1',
    repo: { full_name: REPO },
    changes: [{ section: 'labels', op: 'delete', target: 'old', before: { name: 'old' }, destructive: destructive > 0 }],
    skipped: [],
    destructive,
  })

  test('plan calls POST /api/plan with the bearer token and exits 2', async () => {
    const r = await run(['plan', REPO, '--set', 'house', '--value', 'x=1'], { env: SERVER, fetch: () => json({ ok: true, plan: plan() }) })
    expect(r.code).toBe(2)
    expect(r.calls[0]!.url).toBe('https://ow.example.test/api/plan')
    expect(new Headers(r.calls[0]!.init?.headers).get('authorization')).toBe('Bearer tok')
    expect(JSON.parse(String(r.calls[0]!.init?.body))).toEqual({ repo: REPO, sets: ['house'], values: { x: 1 } })
  })

  test('destructive changes need --confirm owner/repo; nothing is applied without it', async () => {
    const fetch = (url: string) => (url.endsWith('/api/plan') ? json({ ok: true, plan: plan(1) }) : json({ ok: true, report: { repo: REPO, status: 'ok', results: [], skipped: [], applied: 1, failed: 0, run_id: 'r' } }))
    const refused = await run(['apply', REPO, '--yes', '--json'], { env: SERVER, fetch })
    expect(refused.code).toBe(1)
    expect(JSON.parse(refused.stdout)).toMatchObject({ ok: false, code: 'confirm_required', destructive: [{ section: 'labels', op: 'delete', target: 'old' }] })
    expect(refused.calls.map((c) => c.url)).toEqual(['https://ow.example.test/api/plan'])
    const ok = await run(['apply', REPO, '--yes', '--confirm', REPO], { env: SERVER, fetch })
    expect(ok.code).toBe(0)
    expect(JSON.parse(String(ok.calls[1]!.init?.body))).toEqual({ plan_id: 'p1', confirm: REPO })
  })

  test('API errors keep their reason and exit 1', async () => {
    const r = await run(['templates', '--server', 'https://ow.example.test'], { fetch: () => json({ ok: false, message: 'unauthorized', code: 'unauthorized' }, 401) })
    expect(r.code).toBe(1)
    expect(r.stderr).toContain('unauthorized (check OCTOWARDEN_TOKEN)')
  })

  test('audit polls the run and exits 2 on drift', async () => {
    let polls = 0
    const fetch = (url: string) => {
      if (url.endsWith('/api/audit')) return json({ ok: true, run_id: 'run1' })
      polls++
      return json({ ok: true, run: { status: polls < 2 ? 'running' : 'drift', summary: { results: [{ repo: REPO, status: 'done', summary: '1 changes pending', drift: 'drift' }] } } })
    }
    const r = await run(['audit', '--json'], { env: SERVER, fetch })
    expect(r.code).toBe(2)
    expect(JSON.parse(r.stdout).drifts).toEqual([{ repo: REPO, state: 'drift', changes: [], message: '1 changes pending' }])
  }, 10_000)

  test('repos delete needs the exact --confirm', async () => {
    const r = await run(['repos', 'delete', REPO, '--yes'], { env: SERVER, fetch: () => json({ ok: true }) })
    expect(r.code).toBe(1)
    expect(r.calls).toEqual([])
    const ok = await run(['repos', 'delete', REPO, '--yes', '--confirm', REPO], { env: SERVER, fetch: () => json({ ok: true, repo: {} }) })
    expect(ok.code).toBe(0)
    expect(ok.calls[0]!.init?.method).toBe('DELETE')
    expect(ok.calls[0]!.url).toBe(`https://ow.example.test/api/repos/${REPO}`)
  })
})
