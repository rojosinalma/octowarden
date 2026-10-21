import { createGitHubClient, type GitHubClient } from '../../github/client'
import { config } from '../../lib/config'
import { log } from '../../lib/log'
import { getSetting } from '../../lib/settings'
import type { AuthProvider, CredentialSource, Identity } from '../types'

const logger = log.child('github')
const IDENTITY_TTL_MS = 5 * 60_000

async function token(): Promise<{ value: string | undefined; source: CredentialSource }> {
  const stored = await getSetting('github_token')
  if (stored) return { value: stored, source: (await getSetting('github_credential_source')) === 'octoforge' ? 'octoforge' : 'settings' }
  const env = config().githubToken
  return env ? { value: env, source: 'env' } : { value: undefined, source: 'none' }
}

let cached: { token: string; client: GitHubClient } | undefined
let ident: { token: string; value: Identity; at: number } | undefined

/** Personal access token: setting `github_token` (also where octoforge delivers one), else env GITHUB_TOKEN. */
export const pat: AuthProvider = {
  name: 'pat',
  title: 'Personal access token',
  async available() {
    return (await token()).value !== undefined
  },
  async client() {
    const { value } = await token()
    if (!value) throw new Error('no GitHub token: set github_token in Settings or GITHUB_TOKEN')
    if (cached?.token !== value) cached = { token: value, client: createGitHubClient({ mode: 'pat', auth: value }) }
    return cached.client
  },
  async identity() {
    const { value } = await token()
    if (!value) return {}
    if (ident && ident.token === value && Date.now() - ident.at < IDENTITY_TTL_MS) return ident.value
    try {
      const { data } = await (await this.client()).request<{ login: string }>('GET /user')
      ident = { token: value, value: { login: data.login }, at: Date.now() }
      return ident.value
    } catch (err) {
      logger.warn(`token identity unknown: ${(err as Error).message}`)
      return {}
    }
  },
  async source() {
    return (await token()).source
  },
}
