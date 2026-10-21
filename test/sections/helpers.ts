// Shared helpers for section tests: a fake GitHub serving the recorded repo fixture, contexts, fixture loading.
import { createFakeGitHub, fakeError, type FakeGitHub } from '../../src/github/fake'
import { toRepoInfo, type RepoInfo } from '../../src/github/repo'
import { log, setLogLevel } from '../../src/lib/log'
import type { SectionContext } from '../../src/sections/types'
import repoFixture from '../fixtures/repo.json'

setLogLevel(Bun.env.TEST_LOG_LEVEL ?? 'error')

export const repo: RepoInfo = toRepoInfo(repoFixture)
export const privateRepo: RepoInfo = { ...repo, private: true, visibility: 'private' }

/** Recorded GitHub answer from test/fixtures/<path>.json (a fresh copy each time). */
export async function fixture<T = any>(path: string): Promise<T> {
  return (await Bun.file(new URL(`../fixtures/${path}.json`, import.meta.url)).json()) as T
}

export function fakeGitHub(overrides: Record<string, unknown> = {}): FakeGitHub {
  const gh = createFakeGitHub()
  const data = { ...structuredClone(repoFixture), ...overrides }
  gh.on('GET /repos/{owner}/{repo}', () => data)
  return gh
}

export function ctxOf(gh: FakeGitHub, r: RepoInfo = repo, dryRun = true): SectionContext {
  return { gh, repo: r, dryRun, log }
}

/** Every call except reads. */
export function writes(gh: FakeGitHub) {
  return gh.calls.filter((c) => !c.route.startsWith('GET '))
}

export const notFound = (message = 'Not Found') => {
  throw fakeError(404, message)
}

export const OWNER = { owner: 'octo-example', repo: 'demo' }
