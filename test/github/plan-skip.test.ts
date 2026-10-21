import { beforeEach, describe, expect, test } from 'bun:test'
import { setGitHubClient } from '../../src/auth/providers'
import { plan } from '../../src/engine'
import { createFakeGitHub, fakeError, type FakeGitHub } from '../../src/github/fake'
import { probeGitHubStatus, type GitHubStatus } from '../../src/github/status'
import { memoryLibrary } from '../../src/templates/library'
import { parseYaml } from '../../src/templates/schema'
import * as svc from '../../src/services'
import repoFixture from '../fixtures/repo.json'
import { appWorld, fixture, fresh, REPO, tokenClient } from './helpers'

const ORIGIN = { source: 'cli' as const, actor: 'test', record: false }

const lib = memoryLibrary(
  parseYaml(`apiVersion: octowarden/v1
kind: Template
metadata: {name: gated}
spec:
  sections:
    settings: {has_wiki: true}
    labels:
      labels: [{name: triage, color: ededed}]
    webhooks:
      hooks: [{url: "https://hooks.example.com/new"}]
    files:
      - {path: NOTICE, content: "hello\\n"}
      - {path: .github/workflows/ci.yml, content: "on: push\\n"}
      - {path: CONTRIBUTING.md, content: "hi\\n", pr: {title: Add guide, branch: add-guide}}
`),
)

/** Repo reads for every section the template uses. */
function serveRepoReads(gh: FakeGitHub) {
  gh.on('GET /repos/{owner}/{repo}', () => structuredClone(repoFixture))
  gh.on('GET /repos/{owner}/{repo}/labels', () => [])
  gh.on('GET /repos/{owner}/{repo}/hooks', () => [])
  gh.on('GET /repos/{owner}/{repo}/contents/{path}', () => {
    throw fakeError(404, 'Not Found')
  })
}

async function statusFor(installation: Record<string, string>): Promise<GitHubStatus> {
  const [one] = await fixture<Record<string, unknown>[]>('github/installations')
  await appWorld({ installations: [{ ...one, permissions: installation }] })
  return probeGitHubStatus()
}

const OCTOFORGE_APP = { actions: 'write', administration: 'write', checks: 'read', contents: 'write', metadata: 'read', pull_requests: 'write', workflows: 'write' }

beforeEach(async () => {
  await fresh()
})

describe('plan skips what the credential definitely cannot manage', () => {
  test('the recorded App: webhooks skipped with the reason; everything else planned', async () => {
    const access = await statusFor(OCTOFORGE_APP)
    const gh = createFakeGitHub()
    serveRepoReads(gh)
    const p = await plan({ repo: REPO, templates: ['gated'], library: lib, gh, access, ...ORIGIN })
    expect(p.skipped).toEqual([{ section: 'webhooks', reason: 'GitHub App lacks repository_hooks:write' }])
    expect(p.sections.find((s) => s.section === 'webhooks')?.skipped).toBe('GitHub App lacks repository_hooks:write')
    expect(gh.calls.some((c) => c.route === 'GET /repos/{owner}/{repo}/hooks')).toBe(false)
    expect(p.changes.map((c) => `${c.section}:${c.target}`)).toEqual(['settings:has_wiki', 'labels:triage', 'files:NOTICE', 'files:.github/workflows/ci.yml', 'files:CONTRIBUTING.md'])
  })

  test('without pull_requests and workflows: labels skipped, and only the matching file changes', async () => {
    const { pull_requests: _p, workflows: _w, ...grants } = OCTOFORGE_APP
    const access = await statusFor(grants)
    const gh = createFakeGitHub()
    serveRepoReads(gh)
    const p = await plan({ repo: REPO, templates: ['gated'], library: lib, gh, access, ...ORIGIN })
    expect(p.skipped).toEqual([
      { section: 'labels', target: 'triage', reason: 'GitHub App lacks pull_requests:write' },
      { section: 'webhooks', reason: 'GitHub App lacks repository_hooks:write' },
      { section: 'files', target: '.github/workflows/ci.yml', reason: 'GitHub App lacks workflows:write' },
      { section: 'files', target: 'CONTRIBUTING.md', reason: 'GitHub App lacks pull_requests:write' },
    ])
    expect(p.changes.map((c) => `${c.section}:${c.target}`)).toEqual(['settings:has_wiki', 'files:NOTICE'])
  })

  test('unknown never skips: unreachable GitHub, fine-grained token, check turned off', async () => {
    await appWorld({ failApp: true })
    const unreachable = await probeGitHubStatus()
    tokenClient(undefined)
    const fineGrained = await probeGitHubStatus()
    const gh = createFakeGitHub()
    serveRepoReads(gh)
    for (const access of [unreachable, fineGrained, false as const]) {
      const p = await plan({ repo: REPO, templates: ['gated'], library: lib, gh, access, ...ORIGIN })
      expect(p.skipped).toEqual([])
      expect(p.changes).toHaveLength(6)
    }
  })

  test('classic token without admin scopes: the reason names the scope', async () => {
    tokenClient('public_repo, workflow')
    const access = await probeGitHubStatus()
    const gh = createFakeGitHub()
    serveRepoReads(gh)
    const p = await plan({ repo: REPO, templates: ['gated'], library: lib, gh, access, ...ORIGIN })
    expect(p.skipped.map((s) => s.reason)).toContain('token lacks scope repo')
    expect(p.skipped.find((s) => s.section === 'webhooks')?.reason).toBe('token lacks scope admin:repo_hook')
  })

  test('services plan (no gh given) uses the cached status of the active credential', async () => {
    const gh = createFakeGitHub('app')
    serveRepoReads(gh)
    gh.on('GET /app', async () => fixture('github/app'))
    const [one] = await fixture<unknown[]>('github/installations')
    gh.on('GET /app/installations', () => [one])
    setGitHubClient(gh)
    await svc.saveTemplate(
      { apiVersion: 'octowarden/v1', kind: 'Template', metadata: { name: 'hooks-only', description: '' }, spec: { sections: { webhooks: { hooks: [{ url: 'https://hooks.example.com/new' }] } } } },
      svc.API_CTX,
    )
    const p = await svc.createPlan({ repo: REPO, templates: ['hooks-only'] }, svc.API_CTX)
    expect(p.skipped).toEqual([{ section: 'webhooks', reason: 'GitHub App lacks repository_hooks:write' }])
    expect(p.changes).toEqual([])
  })
})
