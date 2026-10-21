import type { Change } from '../sections/types'

export type PermissionLevel = 'read' | 'write'
/** What a credential proved: a definite level, a definite absence, or nothing (fine-grained tokens expose no grant list). */
export type GrantedLevel = 'read' | 'write' | 'none' | 'unknown'
/** The classic token scopes octowarden asks for. */
export type ClassicScope = 'repo' | 'admin:repo_hook' | 'delete_repo' | 'workflow' | 'read:org'

export type RequiredPermission = {
  /** GitHub App permission name as the API spells it (`administration`, `repository_hooks`, …). */
  key: string
  level: PermissionLevel
  /** What octowarden does with it. */
  why: string
  /** What stops working without it. */
  breaks: string
  /** Sections whose plan and apply need it: a definite gap moves their changes to `skipped`. */
  sections: string[]
  /** Other features that need it (pickers, repo create/delete); never skipped, only shown. */
  features?: string[]
  /** The classic token scope that grants the same access. */
  scope: ClassicScope
  /** Other `<key>:<level>` GitHub accepts for the same calls (e.g. a broader level of another permission). */
  alternatives?: string[]
  /** Only these changes of `sections` need it (absent: the whole section, read included). */
  applies?: (change: Change) => boolean
  /** An organization permission: GitHub never grants it on an installation on a personal account. */
  orgOnly?: true
}

const WORKFLOW_DIR = /^\.github\/workflows\//

/**
 * The permissions octowarden needs, derived from the calls of src/sections/* and src/services/repos.ts
 * (GitHub's "permissions required for fine-grained tokens" table). The single source for octoforge.json
 * (`github.app.permissions`, `github.pat`), the App manifest, docs/github-app.md and the Settings page.
 */
export const REQUIRED_PERMISSIONS: readonly RequiredPermission[] = [
  {
    key: 'administration',
    level: 'write',
    why: 'Changes repo settings, topics, security features, rulesets and branch protection; creates repos in an organization and deletes repos.',
    breaks: 'Settings, topics, security, rulesets and protection are skipped; repos cannot be created in an organization or deleted.',
    sections: ['settings', 'security', 'rulesets', 'protection', 'topics'],
    features: ['repo create (organization)', 'repo delete'],
    scope: 'repo',
  },
  {
    key: 'contents',
    level: 'write',
    why: 'Reads files and branches; commits files and git hooks as one verified commit; creates the branch of a pull request.',
    breaks: 'Files and git hooks are skipped; the branch picker stays empty.',
    sections: ['files', 'githooks'],
    features: ['branch picker'],
    scope: 'repo',
  },
  {
    key: 'pull_requests',
    level: 'write',
    why: 'Creates, changes and deletes labels (GitHub accepts Pull requests write for labels, so Issues is not needed); opens the pull request when a file entry sets `pr`.',
    breaks: 'Label changes and file changes with `pr` are skipped; direct commits still work.',
    sections: ['labels', 'files'],
    scope: 'repo',
    applies: (c) => c.section === 'labels' || Boolean((c.after as { pr?: unknown } | undefined)?.pr),
  },
  {
    key: 'repository_hooks',
    level: 'write',
    why: 'Lists, creates, changes and deletes repository webhooks.',
    breaks: 'Webhooks are skipped.',
    sections: ['webhooks'],
    scope: 'admin:repo_hook',
  },
  {
    key: 'workflows',
    level: 'write',
    why: 'GitHub requires it to write any file under .github/workflows.',
    breaks: 'File changes under .github/workflows are skipped; other files still work.',
    sections: ['files'],
    scope: 'workflow',
    applies: (c) => WORKFLOW_DIR.test(c.target),
  },
  {
    key: 'actions',
    level: 'read',
    why: 'Lists the environments of a repo for the deployment pickers.',
    breaks: 'The environment picker stays empty; nothing else changes.',
    sections: [],
    features: ['environment picker'],
    scope: 'repo',
  },
  {
    key: 'checks',
    level: 'read',
    why: 'Reads check run names on the default branch for the required status check pickers.',
    breaks: 'The status check picker misses check runs; nothing else changes.',
    sections: [],
    features: ['status check picker'],
    scope: 'repo',
  },
  {
    key: 'statuses',
    level: 'read',
    why: 'Reads commit status contexts on the default branch for the required status check pickers.',
    breaks: 'The status check picker misses commit statuses; nothing else changes.',
    sections: [],
    features: ['status check picker'],
    scope: 'repo',
  },
  {
    key: 'members',
    level: 'read',
    why: 'Lists the teams of an organization for the reviewer and bypass pickers.',
    breaks: 'The team picker stays empty; nothing else changes.',
    sections: [],
    features: ['team picker'],
    scope: 'read:org',
    orgOnly: true,
  },
  {
    key: 'metadata',
    level: 'read',
    why: 'Required by GitHub for every App; reads repos, topics and rulesets.',
    breaks: 'Nothing works: GitHub refuses every call.',
    sections: [],
    features: ['everything'],
    scope: 'repo',
  },
]

export type ClassicScopeInfo = {
  key: ClassicScope
  why: string
  breaks: string
  /** Scopes that include this one (GitHub's scope hierarchy). */
  impliedBy?: string[]
  /** Features this scope covers that no App permission maps to. */
  features?: string[]
}

/** Classic token scopes in the order octoforge.json lists them; App permissions map to them through `scope`. */
export const CLASSIC_SCOPES: readonly ClassicScopeInfo[] = [
  { key: 'repo', why: 'Full access to repos: settings, files, labels, topics, rulesets, protection, security.', breaks: 'Nothing works on private repos; changes fail on every repo.' },
  {
    key: 'admin:repo_hook',
    why: 'Manages repository webhooks.',
    breaks: 'Webhooks are skipped.',
    impliedBy: ['repo'],
  },
  { key: 'delete_repo', why: 'Deletes repos.', breaks: 'Repo delete fails; nothing else changes.', features: ['repo delete'] },
  { key: 'workflow', why: 'GitHub requires it to write any file under .github/workflows.', breaks: 'File changes under .github/workflows are skipped.' },
  { key: 'read:org', why: 'Lists organization teams for the pickers.', breaks: 'The team picker stays empty.', impliedBy: ['write:org', 'admin:org'] },
]

export const permId = (p: Pick<RequiredPermission, 'key' | 'level'>) => `${p.key}:${p.level}`

/** `{key: level}` for the App manifest `default_permissions` and octoforge.json. */
export function appPermissions(): Record<string, PermissionLevel> {
  return Object.fromEntries(REQUIRED_PERMISSIONS.map((p) => [p.key, p.level]))
}

export function classicScopes(): ClassicScope[] {
  return CLASSIC_SCOPES.map((s) => s.key)
}

/** Sections that need a classic scope: the sections of every permission it maps to. */
export function scopeSections(scope: ClassicScope): string[] {
  return [...new Set(REQUIRED_PERMISSIONS.filter((p) => p.scope === scope).flatMap((p) => p.sections))]
}

const LEVEL_RANK: Record<string, number> = { none: 0, read: 1, write: 2, admin: 3 }

/** Normalises what GitHub reports (`read`, `write`, `admin`, absent) to a level that compares. */
export function grantedLevel(granted: Record<string, string>, key: string): GrantedLevel {
  const raw = granted[key]
  if (raw === 'unknown') return 'unknown'
  if (raw === 'admin' || raw === 'write') return 'write'
  if (raw === 'read') return 'read'
  return 'none'
}

/** true when `granted` covers `required`, false when it definitely does not, null when unknown. */
export function covers(granted: GrantedLevel, required: PermissionLevel): boolean | null {
  if (granted === 'unknown') return null
  return LEVEL_RANK[granted]! >= LEVEL_RANK[required]!
}

/** Lowest level per key across several grant maps (what every installation has). */
export function lowestGrants(maps: Record<string, string>[]): Record<string, string> {
  if (!maps.length) return {}
  const keys = new Set(maps.flatMap((m) => Object.keys(m)))
  const out: Record<string, string> = {}
  for (const k of keys) {
    const levels = maps.map((m) => grantedLevel(m, k))
    if (levels.includes('none')) continue
    out[k] = levels.reduce((a, b) => (LEVEL_RANK[a]! <= LEVEL_RANK[b]! ? a : b))
  }
  return out
}

/** Whether a grant map satisfies one requirement; an alternative counts. `via` names the alternative used. */
export function permissionState(granted: Record<string, string> | undefined, p: RequiredPermission): { granted: GrantedLevel; ok: boolean | null; via?: string } {
  if (!granted) return { granted: 'unknown', ok: null }
  const level = grantedLevel(granted, p.key)
  const ok = covers(level, p.level)
  if (ok !== false) return { granted: level, ok }
  for (const alt of p.alternatives ?? []) {
    const [k, l] = alt.split(':') as [string, PermissionLevel]
    if (covers(grantedLevel(granted, k), l)) return { granted: level, ok: true, via: alt }
  }
  return { granted: level, ok: false }
}

/** Whether a classic token's scope list covers one scope (hierarchy included); null when the list is unknown. */
export function scopeState(scopes: string[] | undefined, scope: ClassicScope): boolean | null {
  if (!scopes) return null
  const info = CLASSIC_SCOPES.find((s) => s.key === scope)
  return scopes.includes(scope) || (info?.impliedBy ?? []).some((s) => scopes.includes(s))
}

/** `<key>:<level>` of every requirement a grant map definitely misses, in REQUIRED_PERMISSIONS order. */
export function missingGrants(granted: Record<string, string> | undefined, account: 'user' | 'org' = 'org'): string[] {
  if (!granted) return []
  return REQUIRED_PERMISSIONS.filter((p) => !(p.orgOnly && account === 'user') && permissionState(granted, p).ok === false).map(permId)
}
