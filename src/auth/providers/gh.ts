import { createGitHubClient, type GitHubClient } from '../../github/client'
import { log } from '../../lib/log'
import type { AuthProvider, Identity } from '../types'

const logger = log.child('github')
const TOKEN_TTL_MS = 5 * 60_000
const IDENTITY_TTL_MS = 5 * 60_000
const SPAWN_TIMEOUT_MS = 5_000

let cachedToken: { value: string | undefined; at: number } | undefined
let cached: { token: string; client: GitHubClient } | undefined
let ident: { token: string; value: Identity; at: number } | undefined

/** Path of the gh binary on the current PATH, undefined when gh is not installed. */
function ghBinary(): string | undefined {
  return Bun.which('gh', { PATH: process.env.PATH ?? '' }) ?? undefined
}

/** `gh auth token`, cached for 5 minutes; undefined when gh is missing, logged out or slow. */
async function token(): Promise<string | undefined> {
  if (cachedToken && Date.now() - cachedToken.at < TOKEN_TTL_MS) return cachedToken.value
  const bin = ghBinary()
  let value: string | undefined
  if (bin) {
    try {
      const proc = Bun.spawn([bin, 'auth', 'token'], { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', timeout: SPAWN_TIMEOUT_MS })
      const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
      if (code === 0 && out.trim()) value = out.trim()
      else logger.debug(`gh auth token exited ${code}`)
    } catch (err) {
      logger.warn(`gh auth token failed: ${(err as Error).message}`)
    }
  }
  cachedToken = { value, at: Date.now() }
  return value
}

/** Drops the cached token (tests; after `gh auth login`). */
export function resetGhCache(): void {
  cachedToken = undefined
  cached = undefined
  ident = undefined
}

/** The token of a logged-in GitHub CLI (`gh auth token`); mainly for the standalone CLI. */
export const gh: AuthProvider = {
  name: 'gh',
  title: 'GitHub CLI token',
  async available() {
    if (!ghBinary()) return false
    return (await token()) !== undefined
  },
  async client() {
    const value = await token()
    if (!value) throw new Error('no GitHub CLI token: install gh and run `gh auth login`')
    if (cached?.token !== value) cached = { token: value, client: createGitHubClient({ mode: 'gh', auth: value }) }
    return cached.client
  },
  async identity() {
    const value = await token()
    if (!value) return {}
    if (ident && ident.token === value && Date.now() - ident.at < IDENTITY_TTL_MS) return ident.value
    try {
      const { data } = await (await this.client()).request<{ login: string }>('GET /user')
      ident = { token: value, value: { login: data.login }, at: Date.now() }
      return ident.value
    } catch (err) {
      logger.warn(`gh identity unknown: ${(err as Error).message}`)
      return {}
    }
  },
  async source() {
    return (await token()) ? 'gh-cli' : 'none'
  },
}
