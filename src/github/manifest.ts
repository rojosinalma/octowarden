import { appPermissions, type PermissionLevel } from './permissions'

export type AppManifest = {
  name: string
  url: string
  description: string
  public: boolean
  default_permissions: Record<string, PermissionLevel>
  default_events: string[]
  hook_attributes: { url?: string; active: boolean }
  redirect_url: string
  setup_url: string
  setup_on_update: boolean
}

export const MANIFEST_NAME = 'Octowarden'
export const PROJECT_URL = 'https://github.com/rojosinalma/octowarden'
/** Where GitHub sends the browser back with `?code=` after the App is created from the manifest. */
export const APP_CREATED_PATH = '/ui/github/app-created'

/** Base URL without a trailing slash: the `public_url` setting when set, else the request's origin. */
export function publicBase(setting: string, requestOrigin: string): string {
  return (setting.trim() || requestOrigin).replace(/\/+$/, '')
}

/**
 * The GitHub App manifest (https://docs.github.com/apps/sharing-github-apps/registering-a-github-app-from-a-manifest),
 * generated from REQUIRED_PERMISSIONS. No webhook: octowarden only calls GitHub.
 */
export function appManifest(base: string, name = MANIFEST_NAME): AppManifest {
  return {
    name,
    url: PROJECT_URL,
    description: 'Reusable templates for repo settings, security, rulesets, labels, webhooks and files, applied with plan, apply and drift audit.',
    public: false,
    default_permissions: appPermissions(),
    default_events: [],
    hook_attributes: { active: false },
    redirect_url: `${base}${APP_CREATED_PATH}`,
    setup_url: `${base}/`,
    setup_on_update: false,
  }
}

/** Where the manifest form posts: the personal account, or an organization the user can manage. */
export function manifestFormAction(org?: string): string {
  return org ? `https://github.com/organizations/${encodeURIComponent(org)}/settings/apps/new` : 'https://github.com/settings/apps/new'
}
