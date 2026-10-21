import type { GitHubClient } from '../github/client'

export type AuthMode = 'pat' | 'gh' | 'app'

/** Where the active credential came from (octoforge contract `/status` `source`). */
export type CredentialSource = 'settings' | 'octoforge' | 'env' | 'gh-cli' | 'none'

export type Identity = { login?: string; app_slug?: string }

/** One way to get GitHub credentials. Register in src/auth/providers/index.ts. */
export interface AuthProvider {
  name: AuthMode
  title: string
  /** True when this provider has what it needs (token, App id + key, gh CLI); no network call. */
  available(): Promise<boolean>
  /** Client bound to the current credential; rebuilt when the credential changes. Throws when unavailable. */
  client(): Promise<GitHubClient>
  /** Who the credential acts as (cached); `{}` when GitHub cannot be reached. */
  identity(): Promise<Identity>
  source(): Promise<CredentialSource>
}

export type AuthStatus = { mode: AuthMode | 'none'; source: CredentialSource; login?: string; app_slug?: string }
