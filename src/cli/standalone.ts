import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { PROVIDERS } from '../auth/providers'
import type { AuthProvider } from '../auth/types'
import { apply as engineApply, audit as engineAudit, plan as enginePlan } from '../engine'
import type { Plan } from '../engine/types'
import type { GitHubClient } from '../github/client'
import { AppError } from '../lib/json'
import { listSections } from '../sections'
import { builtinDocs, builtinLibrary, layeredLibrary } from '../templates/builtin'
import { memoryLibrary, setToDoc, templateToDoc, type Library } from '../templates/library'
import { parseYaml, toYaml, YamlError, type Document, type ManifestDoc } from '../templates/schema'
import { CliError, type Backend, type DriftLike, type Listed, type PlanLike, type RepoTarget, type Target } from './backend'

/** Reads `-f` files and every .yaml/.yml in `-d` dirs (sorted), in the order given; later names win. */
export async function loadDocuments(files: string[], dirs: string[]): Promise<Document[]> {
  const paths = [...files]
  for (const dir of dirs) {
    let names: string[]
    try {
      names = await readdir(dir)
    } catch (err) {
      throw new CliError(`cannot read directory ${dir}: ${(err as Error).message}`)
    }
    paths.push(...names.filter((n) => /\.ya?ml$/i.test(n)).sort().map((n) => join(dir, n)))
  }
  const docs: Document[] = []
  for (const path of paths) {
    const file = Bun.file(path)
    if (!(await file.exists())) throw new CliError(`file not found: ${path}`)
    try {
      docs.push(...parseYaml(await file.text()))
    } catch (err) {
      if (err instanceof YamlError) throw new CliError(`${path}: ${err.message}`, 'invalid', { issues: err.issues })
      throw err
    }
  }
  return docs
}

/** GitHub credential for standalone runs: GITHUB_TOKEN → `gh auth token` → GitHub App env. */
export async function standaloneAuth(): Promise<{ gh: GitHubClient; actor: string; provider: string }> {
  const order: (AuthProvider | undefined)[] = [PROVIDERS.pat, PROVIDERS.gh, PROVIDERS.app]
  for (const p of order) {
    if (!p || !(await p.available())) continue
    const gh = await p.client()
    const who = await p.identity().catch(() => ({}) as { login?: string; app_slug?: string })
    return { gh, actor: who.login ?? (who.app_slug ? `${who.app_slug}[bot]` : 'cli'), provider: p.name }
  }
  throw new CliError('no GitHub credentials: set GITHUB_TOKEN, log in with `gh auth login`, or set GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY and GITHUB_APP_INSTALLATION_ID', 'unavailable')
}

const engineError = (err: unknown): never => {
  if (err instanceof AppError) throw new CliError(err.message, err.code, err.data)
  throw err
}

/** Engine in-process over the YAML files + the built-in starter templates; nothing is recorded. */
export function standaloneBackend(docs: Document[], auth: () => Promise<{ gh: GitHubClient; actor: string }>): Backend {
  const files = memoryLibrary(docs)
  const library: Library = layeredLibrary(files, builtinLibrary())
  const manifests = docs.filter((d): d is ManifestDoc => d.kind === 'Manifest')
  const entries = (): RepoTarget[] => manifests.flatMap((m) => m.spec.repos.map((r) => ({ repo: r.repo, sets: r.sets, templates: [], values: r.values ?? {} })))
  let session: Promise<{ gh: GitHubClient; actor: string }> | undefined
  const gh = () => (session ??= auth())

  /** Explicit sets/templates, else the repo's Manifest entry (call values win over the entry's). */
  const targetFor = (repo: string, t: Target): Target => {
    if (t.sets.length || t.templates.length) return t
    const e = entries().find((x) => x.repo.toLowerCase() === repo.toLowerCase())
    if (!e) throw new CliError(`${repo}: name --set or --template, or list the repo in a Manifest file`, 'invalid')
    return { sets: e.sets, templates: [], values: { ...e.values, ...t.values } }
  }

  const allDocs = () => {
    const names = new Set(docs.filter((d) => d.kind !== 'Manifest').map((d) => `${d.kind}:${(d as { metadata: { name: string } }).metadata.name}`))
    const builtins = builtinDocs().filter((d) => d.kind !== 'Manifest' && !names.has(`${d.kind}:${d.metadata.name}`))
    return { files: docs, builtins }
  }
  const listKind = (kind: 'Template' | 'Set'): Listed[] => {
    const { files: f, builtins } = allDocs()
    const seen = new Map<string, Listed>()
    for (const [d, builtin] of [...f.map((x) => [x, false] as const), ...builtins.map((x) => [x, true] as const)]) {
      if (d.kind !== kind) continue
      const detail = d.kind === 'Template' ? Object.keys(d.spec.sections).join(', ') : d.kind === 'Set' ? d.spec.templates.join(' → ') : ''
      seen.set(d.metadata.name, { name: d.metadata.name, description: d.metadata.description ?? '', builtin, detail })
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
  }

  return {
    mode: 'standalone',
    async sections() {
      return listSections().map((s) => ({ name: s.name, title: s.title, description: s.description }))
    },
    async templates() {
      return listKind('Template')
    },
    async templateYaml(name) {
      const t = await library.getTemplate(name)
      if (!t) throw new CliError(`template "${name}" not found`, 'not_found')
      return toYaml(templateToDoc(t))
    },
    async sets() {
      return listKind('Set')
    },
    async setYaml(name) {
      const s = await library.getSet(name)
      if (!s) throw new CliError(`set "${name}" not found`, 'not_found')
      return toYaml(setToDoc(s))
    },
    async plan(repo, target) {
      const t = targetFor(repo, target)
      const { gh: client, actor } = await gh()
      return enginePlan({ repo, sets: t.sets, templates: t.templates, values: t.values, source: 'cli', actor, gh: client, library, record: false }).catch(engineError)
    },
    async apply(plan, confirm) {
      const { gh: client, actor } = await gh()
      return engineApply(plan as Plan, { source: 'cli', actor, confirm, gh: client, record: false }).catch(engineError)
    },
    async syncTargets() {
      const list = entries()
      if (!list.length) throw new CliError('sync needs a Manifest document in the --file/--dir YAML (kind: Manifest, spec.repos)', 'invalid')
      return list
    },
    async audit(repos, target) {
      const list = repos.length ? repos.map((repo) => ({ repo, ...targetFor(repo, target) })) : entries()
      if (!list.length) throw new CliError('audit: name repos, or list them in a Manifest file', 'invalid')
      const { gh: client, actor } = await gh()
      const out: DriftLike[] = []
      for (const r of list) {
        const d = await engineAudit(r.repo, { source: 'cli', actor, gh: client, library, record: false, sets: r.sets, templates: r.templates, values: { ...r.values, ...target.values } })
        out.push({ repo: d.repo, state: d.state, changes: d.changes, message: d.message })
      }
      return out
    },
    async exportYaml(opts) {
      if (opts.manifest) throw new CliError('--manifest needs --server: repo assignments live on the server', 'invalid')
      const named = opts.templates.length || opts.sets.length
      if (!named) {
        const own = docs.filter((d) => d.kind !== 'Manifest')
        return toYaml(own.length ? docs : builtinDocs())
      }
      const out: Document[] = []
      for (const n of opts.templates) {
        const t = await library.getTemplate(n)
        if (!t) throw new CliError(`template "${n}" not found`, 'not_found')
        out.push(templateToDoc(t))
      }
      for (const n of opts.sets) {
        const s = await library.getSet(n)
        if (!s) throw new CliError(`set "${n}" not found`, 'not_found')
        out.push(setToDoc(s))
      }
      return toYaml(out)
    },
    async importYaml(text) {
      let parsed: Document[]
      try {
        parsed = parseYaml(text)
      } catch (err) {
        if (err instanceof YamlError) throw new CliError(err.message, 'invalid', { issues: err.issues })
        throw err
      }
      return {
        stored: false,
        templates: parsed.filter((d) => d.kind === 'Template').length,
        sets: parsed.filter((d) => d.kind === 'Set').length,
        repos: parsed.flatMap((d) => (d.kind === 'Manifest' ? d.spec.repos : [])).length,
      }
    },
    async repos() {
      throw new CliError('repos needs --server (or OCTOWARDEN_SERVER): the repo list lives on the server', 'invalid')
    },
    async createRepo() {
      throw new CliError('repos create needs --server (or OCTOWARDEN_SERVER)', 'invalid')
    },
    async deleteRepo() {
      throw new CliError('repos delete needs --server (or OCTOWARDEN_SERVER)', 'invalid')
    },
  }
}

export type { PlanLike }
