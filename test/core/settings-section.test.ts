import { describe, expect, test } from 'bun:test'
import { createFakeGitHub } from '../../src/github/fake'
import { toRepoInfo } from '../../src/github/repo'
import { log } from '../../src/lib/log'
import { getSection, listSections } from '../../src/sections'
import { settings } from '../../src/sections/settings'
import repoFixture from '../fixtures/repo.json'
import { serveRepo } from './helpers'

const repo = toRepoInfo(repoFixture)

describe('settings section', () => {
  test('is registered', () => {
    expect(getSection('settings')).toBe(settings)
    expect(listSections().map((s) => s.name)).toContain('settings')
    expect(getSection('constructor')).toBeUndefined()
  })

  test('read maps the recorded GET /repos answer; null homepage becomes ""', async () => {
    const gh = createFakeGitHub()
    serveRepo(gh)
    const current = await settings.read({ gh, repo, dryRun: true, log })
    expect(current.allow_squash_merge).toBe(true)
    expect(current.allow_merge_commit).toBe(true)
    expect(current.squash_merge_commit_title).toBe('COMMIT_OR_PR_TITLE')
    expect(current.homepage).toBe('')
    expect(gh.calls[0]).toEqual({ route: 'GET /repos/{owner}/{repo}', params: { owner: 'octo-example', repo: 'demo' } })
  })

  test('diff: one change per desired field, noop when equal, nothing destructive', async () => {
    const gh = createFakeGitHub()
    serveRepo(gh)
    const current = await settings.read({ gh, repo, dryRun: true, log })
    const changes = settings.diff(
      { allow_squash_merge: true, allow_merge_commit: false, squash_merge_commit_title: 'PR_TITLE', delete_branch_on_merge: true, has_wiki: false },
      current,
      repo,
    )
    expect(changes.map((c) => [c.target, c.op])).toEqual([
      ['has_wiki', 'noop'],
      ['allow_merge_commit', 'update'],
      ['allow_squash_merge', 'noop'],
      ['delete_branch_on_merge', 'update'],
      ['squash_merge_commit_title', 'update'],
    ])
    expect(changes.find((c) => c.target === 'allow_merge_commit')).toMatchObject({ before: true, after: false, destructive: false })
  })

  test('apply sends one PATCH with every change', async () => {
    const gh = createFakeGitHub()
    const state = serveRepo(gh)
    const changes = settings.diff({ has_wiki: true, allow_auto_merge: true }, await settings.read({ gh, repo, dryRun: true, log }), repo)
    const results = await settings.apply({ gh, repo, dryRun: false, log }, changes.filter((c) => c.op !== 'noop'))
    expect(results.map((r) => r.outcome)).toEqual(['applied', 'applied'])
    const patches = gh.calls.filter((c) => c.route.startsWith('PATCH'))
    expect(patches).toHaveLength(1)
    expect(patches[0]!.params).toEqual({ owner: 'octo-example', repo: 'demo', has_wiki: true, allow_auto_merge: true })
    expect(state.has_wiki).toBe(true)
  })

  test('schema rejects unknown fields and bad enums', () => {
    expect(settings.schema.safeParse({ visibility: 'private' }).success).toBe(false)
    expect(settings.schema.safeParse({ squash_merge_commit_title: 'NOPE' }).success).toBe(false)
    expect(settings.schema.safeParse({ homepage: 'ftp://x' }).success).toBe(false)
    expect(settings.schema.safeParse({ homepage: '' }).success).toBe(true)
  })

  test('archived repos are not supported', () => {
    expect(settings.supports!({ ...repo, archived: true })).toEqual({ ok: false, reason: 'repository is archived' })
  })
})
