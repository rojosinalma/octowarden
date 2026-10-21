import { z } from 'zod'
import { GitHubError } from '../github/client'
import type { ApplyResult, Change, Section, SectionContext } from './types'
import { failed, notArchived, statusOf } from './util'

const flag = (text: string) => z.boolean().optional().describe(text)

const config = z
  .strictObject({
    vulnerability_alerts: flag('Dependabot alerts for vulnerable dependencies.'),
    automated_security_fixes: flag('Dependabot security updates: pull requests that fix vulnerable dependencies (needs alerts on).'),
    secret_scanning: flag('Secret scanning. Free on public repos; private repos need GitHub Secret Protection / Advanced Security.'),
    secret_scanning_push_protection: flag('Block pushes that contain secrets (needs secret scanning on).'),
    secret_scanning_non_provider_patterns: flag('Also scan for generic secrets (passwords, keys) without a provider pattern.'),
    secret_scanning_ai_detection: flag('AI-based detection of generic passwords.'),
    advanced_security: flag('GitHub Advanced Security (paid on private repos).'),
    code_security: flag('GitHub Code Security (paid on private repos).'),
    private_vulnerability_reporting: flag('Let people report vulnerabilities privately (public repos only).'),
  })
  .describe('Dependabot alerts and updates, secret scanning, push protection, private vulnerability reporting.')

export type SecurityConfig = z.infer<typeof config>
export type SecurityField = keyof SecurityConfig
export type SecurityCurrent = {
  values: Partial<Record<SecurityField, boolean>>
  /** Fields this repo cannot use, with the reason. */
  unavailable: Partial<Record<SecurityField, string>>
}

/** Fields set through `PATCH /repos` `security_and_analysis.<field>.status`. */
const ANALYSIS: readonly SecurityField[] = [
  'advanced_security',
  'code_security',
  'secret_scanning',
  'secret_scanning_push_protection',
  'secret_scanning_non_provider_patterns',
  'secret_scanning_ai_detection',
]
const SECRET_FIELDS = new Set<SecurityField>(['secret_scanning', 'secret_scanning_push_protection', 'secret_scanning_non_provider_patterns', 'secret_scanning_ai_detection'])
const FIELDS = Object.keys(config.shape) as SecurityField[]

type Analysis = Record<string, { status?: string } | undefined> | null | undefined

const PRIVATE_SECRET = 'secret scanning on a private repository needs GitHub Secret Protection (Advanced Security)'
const PRIVATE_PVR = 'private vulnerability reporting is only available on public repositories'

/** Toggle endpoints: GET answers enabled/disabled, PUT enables, DELETE disables. */
const TOGGLES: Partial<Record<SecurityField, string>> = {
  vulnerability_alerts: '/repos/{owner}/{repo}/vulnerability-alerts',
  automated_security_fixes: '/repos/{owner}/{repo}/automated-security-fixes',
  private_vulnerability_reporting: '/repos/{owner}/{repo}/private-vulnerability-reporting',
}

async function readToggle(ctx: SectionContext, field: SecurityField): Promise<boolean | undefined> {
  const route = `GET ${TOGGLES[field]}`
  try {
    const { data } = await ctx.gh.request<{ enabled?: boolean } | undefined>(route, { owner: ctx.repo.owner, repo: ctx.repo.name })
    // vulnerability-alerts answers 204 (no body) when on; the others carry {enabled}.
    return typeof data?.enabled === 'boolean' ? data.enabled : true
  } catch (err) {
    if (field === 'vulnerability_alerts' && statusOf(err) === 404) return false
    if (err instanceof GitHubError && (err.status === 404 || err.status === 422 || err.status === 403)) return undefined
    throw err
  }
}

/** Repo security features. Missing features (plan, visibility, token rights) are skipped per field with the reason. */
export const security: Section<SecurityConfig, SecurityCurrent> = {
  name: 'security',
  title: 'Security',
  description: config.description!,
  schema: config,

  async read(ctx, desired) {
    const wanted = FIELDS.filter((f) => !desired || desired[f] !== undefined)
    const out: SecurityCurrent = { values: {}, unavailable: {} }
    if (wanted.some((f) => ANALYSIS.includes(f))) {
      const { data } = await ctx.gh.request<{ security_and_analysis?: Analysis }>('GET /repos/{owner}/{repo}', { owner: ctx.repo.owner, repo: ctx.repo.name })
      const sa = data.security_and_analysis
      const paid = sa?.advanced_security?.status === 'enabled' || sa?.secret_protection?.status === 'enabled'
      for (const f of wanted.filter((x) => ANALYSIS.includes(x))) {
        const status = sa?.[f]?.status
        if (status === 'enabled' || status === 'disabled') out.values[f] = status === 'enabled'
        if (!sa) out.unavailable[f] = 'security_and_analysis is not visible: the credential needs admin access to the repository'
        else if (ctx.repo.private && SECRET_FIELDS.has(f) && !paid) out.unavailable[f] = PRIVATE_SECRET
        else if (status === undefined) out.unavailable[f] = `${f} is not available on this repository`
      }
    }
    for (const f of wanted.filter((x) => TOGGLES[x])) {
      if (f === 'private_vulnerability_reporting' && ctx.repo.private) {
        out.unavailable[f] = PRIVATE_PVR
        continue
      }
      const v = await readToggle(ctx, f)
      if (v === undefined) out.unavailable[f] = `${f.replaceAll('_', ' ')} is not available on this repository`
      else out.values[f] = v
    }
    return out
  },

  diff(desired, current) {
    const changes: Change[] = []
    for (const f of FIELDS) {
      const want = desired[f]
      if (want === undefined) continue
      const before = current.values[f]
      const same = before === want
      const change: Change = { section: 'security', op: same ? 'noop' : 'update', target: f, before, after: want, destructive: false }
      const why = current.unavailable[f]
      if (!same && why) change.skip = why
      changes.push(change)
    }
    return changes
  },

  async apply(ctx, changes) {
    const results: ApplyResult[] = []
    const base = { owner: ctx.repo.owner, repo: ctx.repo.name }
    const analysis = changes.filter((c) => ANALYSIS.includes(c.target as SecurityField))
    if (analysis.length) {
      const body: Record<string, { status: string }> = {}
      for (const c of analysis) body[c.target] = { status: c.after ? 'enabled' : 'disabled' }
      try {
        await ctx.gh.request('PATCH /repos/{owner}/{repo}', { ...base, security_and_analysis: body })
        for (const c of analysis) results.push({ change: c, outcome: 'applied', message: `${c.target} ${c.after ? 'enabled' : 'disabled'}` })
      } catch (err) {
        for (const c of analysis) results.push(failed(c, err))
      }
    }
    // Alerts before security fixes: GitHub refuses fixes while alerts are off.
    const order: SecurityField[] = ['vulnerability_alerts', 'automated_security_fixes', 'private_vulnerability_reporting']
    for (const f of order) {
      const c = changes.find((x) => x.target === f)
      if (!c) continue
      try {
        await ctx.gh.request(`${c.after ? 'PUT' : 'DELETE'} ${TOGGLES[f]}`, base)
        results.push({ change: c, outcome: 'applied', message: `${f} ${c.after ? 'enabled' : 'disabled'}` })
      } catch (err) {
        results.push(failed(c, err))
      }
    }
    return results
  },

  supports: notArchived,
}
