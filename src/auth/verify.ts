import { createGitHubClient, GitHubError } from '../github/client'
import { pem } from '../lib/config'
import { ValidationError } from '../lib/json'
import { appJwtClient } from './providers/app'

export type VerifyInput =
  | { mode: 'pat'; token: string }
  | { mode: 'app'; app_id: string | number; private_key: string; installation_id?: string | number | null }

export type Verified = { login?: string } | { app_slug?: string }

const reason = (err: unknown) => (err instanceof GitHubError && err.status ? `${err.message} (HTTP ${err.status})` : (err as Error).message)

/**
 * Checks a credential against GitHub before it is stored (octoforge PUT /github, Settings).
 * PAT → `GET /user` → `{login}`; App → `GET /app` with the JWT (and the installation when given) → `{app_slug}`.
 * Throws ValidationError with GitHub's reason; never echoes the secret.
 */
export async function verifyCredential(input: VerifyInput): Promise<Verified> {
  if (input.mode === 'pat') {
    if (!input.token?.trim()) throw new ValidationError('token is empty')
    try {
      const gh = createGitHubClient({ mode: 'pat', auth: input.token.trim() })
      const { data } = await gh.request<{ login: string }>('GET /user')
      return { login: data.login }
    } catch (err) {
      throw new ValidationError(`GitHub rejected the token: ${reason(err)}`)
    }
  }
  const appId = String(input.app_id ?? '').trim()
  if (!/^\d+$/.test(appId)) throw new ValidationError('app_id must be a number')
  const key = pem(input.private_key?.trim())
  if (!key || !/-----BEGIN (RSA )?PRIVATE KEY-----/.test(key)) throw new ValidationError('private_key must be a PEM private key')
  const installation = input.installation_id == null || input.installation_id === '' ? undefined : String(input.installation_id)
  if (installation !== undefined && !/^\d+$/.test(installation)) throw new ValidationError('installation_id must be a number')
  try {
    const jwt = appJwtClient(appId, key)
    const { data } = await jwt.request<{ slug: string }>('GET /app')
    if (installation) await jwt.request('GET /app/installations/{installation_id}', { installation_id: Number(installation) })
    return { app_slug: data.slug }
  } catch (err) {
    throw new ValidationError(`GitHub rejected the App credentials: ${reason(err)}`)
  }
}
