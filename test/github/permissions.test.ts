import { describe, expect, test } from 'bun:test'
import octoforge from '../../octoforge.json'
import { appManifest, manifestFormAction, publicBase } from '../../src/github/manifest'
import {
  appPermissions,
  CLASSIC_SCOPES,
  classicScopes,
  lowestGrants,
  missingGrants,
  permissionState,
  REQUIRED_PERMISSIONS,
  scopeState,
} from '../../src/github/permissions'
import { sectionNames } from '../../src/sections'

const docs = await Bun.file(new URL('../../docs/github-app.md', import.meta.url)).text()

/** Rows of the markdown table between `<!-- name:start -->` and `<!-- name:end -->`, cells trimmed. */
function tableRows(name: string): string[][] {
  const block = docs.split(`<!-- ${name}:start -->`)[1]?.split(`<!-- ${name}:end -->`)[0]
  if (!block) throw new Error(`docs/github-app.md has no ${name} block`)
  return block
    .trim()
    .split('\n')
    .slice(2)
    .map((line) =>
      line
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => c.trim()),
    )
}

const usedBy = (p: (typeof REQUIRED_PERMISSIONS)[number]) => [...p.sections.map((s) => `\`${s}\``), ...(p.features ?? [])].join(', ')

describe('REQUIRED_PERMISSIONS is the single source', () => {
  test('octoforge.json github.app.permissions and github.pat equal the generated lists', () => {
    expect(octoforge.github.app.permissions as Record<string, string>).toEqual(appPermissions())
    expect(octoforge.github.pat.fine_grained as Record<string, string>).toEqual(appPermissions())
    expect(octoforge.github.pat.classic_scopes as string[]).toEqual(classicScopes())
    expect(octoforge.github.app.events).toEqual([])
  })

  test('every registered section needs at least one permission; every named section exists', () => {
    const named = new Set(REQUIRED_PERMISSIONS.flatMap((p) => p.sections))
    for (const s of sectionNames()) expect(named.has(s)).toBe(true)
    for (const s of named) expect(sectionNames()).toContain(s)
    expect(new Set(REQUIRED_PERMISSIONS.map((p) => p.key)).size).toBe(REQUIRED_PERMISSIONS.length)
  })

  test('docs/github-app.md permission table equals the list', () => {
    expect(tableRows('permissions')).toEqual(REQUIRED_PERMISSIONS.map((p) => [`\`${p.key}\``, p.level, usedBy(p), p.why, p.breaks]))
  })

  test('docs/github-app.md scope table equals CLASSIC_SCOPES', () => {
    expect(tableRows('scopes')).toEqual(CLASSIC_SCOPES.map((s) => [`\`${s.key}\``, s.why, s.breaks]))
  })

  test('docs/github-app.md manifest equals the generated one', () => {
    const block = docs.split('<!-- manifest:start -->')[1]!.split('<!-- manifest:end -->')[0]!
    const json = block.replace(/^\s*```json\n/, '').replace(/```\s*$/, '')
    expect(JSON.parse(json)).toEqual(appManifest('<PUBLIC_URL>'))
  })
})

describe('grant evaluation', () => {
  test('admin covers write; absent is none; unknown stays unknown', () => {
    const p = REQUIRED_PERMISSIONS.find((x) => x.key === 'administration')!
    expect(permissionState({ administration: 'admin' }, p)).toEqual({ granted: 'write', ok: true })
    expect(permissionState({}, p)).toEqual({ granted: 'none', ok: false })
    expect(permissionState({ administration: 'read' }, p)).toEqual({ granted: 'read', ok: false })
    expect(permissionState(undefined, p)).toEqual({ granted: 'unknown', ok: null })
  })

  test('labels: pull_requests:write is accepted instead of issues:write', () => {
    const issues = REQUIRED_PERMISSIONS.find((x) => x.key === 'issues')!
    expect(permissionState({ pull_requests: 'write' }, issues)).toEqual({ granted: 'none', ok: true, via: 'pull_requests:write' })
    expect(permissionState({ pull_requests: 'read' }, issues).ok).toBe(false)
  })

  test('missingGrants of the recorded OctoForge App', () => {
    const app = { actions: 'write', administration: 'write', checks: 'read', contents: 'write', metadata: 'read', pull_requests: 'write', workflows: 'write' }
    expect(missingGrants(app)).toEqual(['repository_hooks:write', 'statuses:read', 'members:read'])
    const { pull_requests: _, ...noPr } = app
    expect(missingGrants(noPr)).toEqual(['issues:write', 'pull_requests:write', 'repository_hooks:write', 'statuses:read', 'members:read'])
    expect(missingGrants(undefined)).toEqual([])
  })

  test('lowestGrants keeps the lowest level and drops keys one map lacks', () => {
    expect(lowestGrants([{ contents: 'write', issues: 'write' }, { contents: 'read' }])).toEqual({ contents: 'read' })
    expect(lowestGrants([])).toEqual({})
  })

  test('classic scope hierarchy: repo includes admin:repo_hook, admin:org includes read:org', () => {
    expect(scopeState(['repo'], 'admin:repo_hook')).toBe(true)
    expect(scopeState(['admin:org'], 'read:org')).toBe(true)
    expect(scopeState(['public_repo'], 'repo')).toBe(false)
    expect(scopeState(undefined, 'repo')).toBeNull()
  })
})

describe('App manifest', () => {
  test('generated from the permissions, no webhook, URLs from the base', () => {
    const m = appManifest(publicBase('', 'https://ow.example.test'))
    expect(m.default_permissions).toEqual(appPermissions())
    expect(m.hook_attributes).toEqual({ active: false })
    expect(m.default_events).toEqual([])
    expect(m.public).toBe(false)
    expect(m.redirect_url).toBe('https://ow.example.test/ui/github/app-created')
    expect(m.setup_url).toBe('https://ow.example.test/')
  })

  test('public_url wins over the request origin; trailing slashes go', () => {
    expect(publicBase('https://warden.example.com/', 'http://localhost:3000')).toBe('https://warden.example.com')
    expect(publicBase('  ', 'http://localhost:3000')).toBe('http://localhost:3000')
  })

  test('form action: personal account or organization', () => {
    expect(manifestFormAction()).toBe('https://github.com/settings/apps/new')
    expect(manifestFormAction('octo-org')).toBe('https://github.com/organizations/octo-org/settings/apps/new')
  })
})
