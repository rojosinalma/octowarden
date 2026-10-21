import { basename } from 'node:path'
import type { GitHubClient } from '../github/client'
import { setLogLevel } from '../lib/log'
import { VERSION } from '../lib/version'
import { checkRepo, parseCli, UsageError, type Args } from './args'
import { CliError, type Backend, type DriftLike, type PlanLike, type ReportLike } from './backend'
import { helpText } from './help'
import { driftText, paint, planText, reportText, table, type Paint } from './output'
import { serverBackend } from './server'
import { loadDocuments, standaloneAuth, standaloneBackend } from './standalone'

export type Io = {
  stdout(text: string): void
  stderr(text: string): void
  /** stdout is a terminal (colours, confirmation prompts). */
  isTTY: boolean
  env: Record<string, string | undefined>
  fetch: (input: string, init?: RequestInit) => Promise<Response>
  /** Reads one answer from the terminal; null when there is none. */
  prompt(question: string): Promise<string | null>
  /** Program name in help text (`octowarden`, or `gh octowarden` as a gh extension). */
  prog: string
  /** Tests: GitHub client and actor for standalone mode instead of the real credentials. */
  github?: { gh: GitHubClient; actor: string }
}

export const EXIT = { ok: 0, error: 1, pending: 2 } as const

function defaultIo(): Io {
  const names = [basename(process.argv[1] ?? ''), basename(process.env._ ?? '')]
  const script = names.find((n) => n.startsWith('gh-')) ?? names[0]!
  return {
    stdout: (t) => void process.stdout.write(t),
    stderr: (t) => void process.stderr.write(t),
    isTTY: Boolean(process.stdout.isTTY),
    env: process.env,
    fetch: (input, init) => fetch(input, init),
    prompt: async (q) => (process.stdin.isTTY ? globalThis.prompt(q) : null),
    prog: script.startsWith('gh-') ? `gh ${script.slice(3)}` : 'octowarden',
  }
}

type Ctx = { args: Args; io: Io; p: Paint; backend: () => Promise<Backend> }

const out = (ctx: Ctx, text: string) => ctx.io.stdout(text.endsWith('\n') ? text : `${text}\n`)
const err = (ctx: Ctx, text: string) => ctx.io.stderr(text.endsWith('\n') ? text : `${text}\n`)
const json = (ctx: Ctx, value: unknown) => ctx.io.stdout(`${JSON.stringify(value, null, 2)}\n`)

/** Asks on a terminal; refuses (false + reason) without one unless --yes. */
async function confirmed(ctx: Ctx, question: string): Promise<boolean> {
  if (ctx.args.yes) return true
  if (!ctx.io.isTTY || ctx.args.json) throw new CliError('not a terminal: pass --yes to apply without asking', 'confirm_required')
  const answer = await ctx.io.prompt(`${question} [y/N]`)
  return /^y(es)?$/i.test((answer ?? '').trim())
}

/** Destructive changes need --confirm <owner/repo>; refused before anything is written. */
function checkDestructive(ctx: Ctx, plan: PlanLike): void {
  if (!plan.destructive || ctx.args.confirm === plan.repo.full_name) return
  const list = plan.changes.filter((c) => c.destructive).map((c) => ({ section: c.section, op: c.op, target: c.target }))
  throw new CliError(`${plan.repo.full_name}: ${plan.destructive} destructive change${plan.destructive === 1 ? '' : 's'}; rerun with --confirm ${plan.repo.full_name}`, 'confirm_required', { destructive: list })
}

const target = (a: Args) => ({ sets: a.sets, templates: a.templates, values: a.values })

async function cmdPlan(ctx: Ctx): Promise<number> {
  const repo = checkRepo(ctx.args.rest[0])
  const plan = await (await ctx.backend()).plan(repo, target(ctx.args))
  if (ctx.args.json) json(ctx, { ok: true, message: `${plan.changes.length} changes`, plan })
  else out(ctx, planText(plan, ctx.p))
  return plan.changes.length ? EXIT.pending : EXIT.ok
}

async function applyOne(ctx: Ctx, b: Backend, plan: PlanLike): Promise<ReportLike> {
  checkDestructive(ctx, plan)
  return b.apply(plan, ctx.args.confirm)
}

async function cmdApply(ctx: Ctx): Promise<number> {
  const repo = checkRepo(ctx.args.rest[0])
  const b = await ctx.backend()
  const plan = await b.plan(repo, target(ctx.args))
  if (!ctx.args.json) out(ctx, planText(plan, ctx.p))
  if (!plan.changes.length) {
    if (ctx.args.json) json(ctx, { ok: true, message: 'nothing to apply', plan, report: null })
    return EXIT.ok
  }
  checkDestructive(ctx, plan)
  if (!(await confirmed(ctx, `Apply ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'} to ${repo}?`))) {
    err(ctx, 'not applied')
    return EXIT.error
  }
  const report = await applyOne(ctx, b, plan)
  if (ctx.args.json) json(ctx, { ok: report.failed === 0, message: `${report.applied} applied, ${report.failed} failed`, plan, report })
  else out(ctx, reportText(report, ctx.p))
  return report.failed ? EXIT.error : EXIT.ok
}

async function cmdSync(ctx: Ctx): Promise<number> {
  const b = await ctx.backend()
  const targets = await b.syncTargets()
  const plans: PlanLike[] = []
  const failures: { repo: string; message: string }[] = []
  for (const t of targets) {
    try {
      const plan = await b.plan(t.repo, { sets: t.sets, templates: t.templates, values: { ...t.values, ...ctx.args.values } })
      plans.push(plan)
      if (!ctx.args.json) out(ctx, planText(plan, ctx.p))
    } catch (e) {
      failures.push({ repo: t.repo, message: (e as Error).message })
      if (!ctx.args.json) err(ctx, ctx.p.red(`${t.repo}: ${(e as Error).message}`))
    }
  }
  const pending = plans.filter((p) => p.changes.length)
  const results: { repo: string; plan: PlanLike; report?: ReportLike; error?: string }[] = plans.map((plan) => ({ repo: plan.repo.full_name, plan }))
  if (pending.length) {
    const total = pending.reduce((n, p) => n + p.changes.length, 0)
    if (!(await confirmed(ctx, `Apply ${total} change${total === 1 ? '' : 's'} to ${pending.length} repo${pending.length === 1 ? '' : 's'}?`))) {
      err(ctx, 'not applied')
      return EXIT.error
    }
    for (const plan of pending) {
      const r = results.find((x) => x.plan === plan)!
      try {
        r.report = await applyOne(ctx, b, plan)
        if (!ctx.args.json) out(ctx, reportText(r.report, ctx.p))
        if (r.report.failed) failures.push({ repo: r.repo, message: `${r.report.failed} changes failed` })
      } catch (e) {
        r.error = (e as Error).message
        failures.push({ repo: r.repo, message: r.error })
        if (!ctx.args.json) err(ctx, ctx.p.red(`${r.repo}: ${r.error}`))
      }
    }
  } else if (!ctx.args.json) out(ctx, ctx.p.green('every repo is in sync'))
  if (ctx.args.json) json(ctx, { ok: failures.length === 0, message: `${pending.length} repos applied, ${failures.length} failed`, results, failures })
  return failures.length ? EXIT.error : EXIT.ok
}

async function cmdAudit(ctx: Ctx): Promise<number> {
  const repos = ctx.args.rest.map((r) => checkRepo(r))
  const drifts: DriftLike[] = await (await ctx.backend()).audit(repos, target(ctx.args))
  const errors = drifts.filter((d) => d.state === 'error').length
  const drift = drifts.filter((d) => d.state === 'drift').length
  if (ctx.args.json) json(ctx, { ok: errors === 0, message: `${drifts.length} repos: ${drift} drifting, ${errors} failed`, drifts })
  else {
    for (const d of drifts) out(ctx, driftText(d, ctx.p))
    out(ctx, ctx.p.dim(`${drifts.length} repos: ${drifts.length - drift - errors} in sync, ${drift} drifting, ${errors} failed`))
  }
  return errors ? EXIT.error : drift ? EXIT.pending : EXIT.ok
}

async function cmdList(ctx: Ctx, kind: 'templates' | 'sets'): Promise<number> {
  const b = await ctx.backend()
  const [sub = 'list', name] = ctx.args.rest
  if (sub === 'show') {
    if (!name) throw new UsageError(`${kind} show needs a name`)
    const yaml = kind === 'templates' ? await b.templateYaml(name) : await b.setYaml(name)
    if (ctx.args.json) json(ctx, { ok: true, message: name, yaml })
    else out(ctx, yaml)
    return EXIT.ok
  }
  if (sub !== 'list') throw new UsageError(`${kind}: unknown sub-command "${sub}" (list, show <name>)`)
  const items = kind === 'templates' ? await b.templates() : await b.sets()
  if (ctx.args.json) json(ctx, { ok: true, message: `${items.length} ${kind}`, [kind]: items })
  else if (!items.length) out(ctx, `no ${kind}`)
  else out(ctx, table(items.map((i) => [i.name + (i.builtin ? ' (built-in)' : ''), i.detail, i.description])))
  return EXIT.ok
}

async function cmdSections(ctx: Ctx): Promise<number> {
  const sections = await (await ctx.backend()).sections()
  if (ctx.args.json) json(ctx, { ok: true, message: `${sections.length} sections`, sections: sections.map((s) => ({ name: s.name, title: s.title, description: s.description })) })
  else out(ctx, table(sections.map((s) => [s.name, s.title, s.description])))
  return EXIT.ok
}

async function cmdExport(ctx: Ctx): Promise<number> {
  const yaml = await (await ctx.backend()).exportYaml({ templates: ctx.args.templates, sets: ctx.args.sets, manifest: ctx.args.manifest })
  if (ctx.args.json) json(ctx, { ok: true, message: 'exported', yaml })
  else out(ctx, yaml || '# nothing to export\n')
  return EXIT.ok
}

async function cmdImport(ctx: Ctx): Promise<number> {
  const path = ctx.args.rest[0]
  if (!path) throw new UsageError('import needs a YAML file')
  const file = Bun.file(path)
  if (!(await file.exists())) throw new CliError(`file not found: ${path}`)
  const r = await (await ctx.backend()).importYaml(await file.text())
  const what = `${r.templates} templates, ${r.sets} sets, ${r.repos} repo assignments`
  const message = r.stored ? `imported ${what}` : `valid: ${what} (checked only; pass --server to store them)`
  if (ctx.args.json) json(ctx, { ok: true, message, counts: { templates: r.templates, sets: r.sets, repos: r.repos }, stored: r.stored })
  else out(ctx, message)
  return EXIT.ok
}

async function cmdRepos(ctx: Ctx): Promise<number> {
  const b = await ctx.backend()
  const [sub = 'list', repoArg] = ctx.args.rest
  if (sub === 'list') {
    const repos = await b.repos()
    if (ctx.args.json) json(ctx, { ok: true, message: `${repos.length} repos`, repos })
    else out(ctx, repos.length ? table(repos.map((r) => [r.full_name, r.visibility, r.drift_state, r.sets.map((s) => s.set).join(', ')])) : 'no repos')
    return EXIT.ok
  }
  if (sub === 'create') {
    if (!ctx.args.name) throw new UsageError('repos create needs --name')
    if (!ctx.args.visibility) throw new UsageError('repos create needs --private or --public')
    const repo = await b.createRepo({ owner: ctx.args.owner, name: ctx.args.name, private: ctx.args.visibility === 'private', description: ctx.args.description, sets: ctx.args.sets })
    if (ctx.args.json) json(ctx, { ok: true, message: `${repo.full_name} created`, repo })
    else out(ctx, `${repo.full_name} created`)
    return EXIT.ok
  }
  if (sub === 'delete') {
    const repo = checkRepo(repoArg)
    if (ctx.args.confirm !== repo) throw new CliError(`deleting ${repo} cannot be undone: rerun with --confirm ${repo}`, 'confirm_required')
    if (b.mode === 'standalone') await b.deleteRepo(repo, ctx.args.confirm)
    if (!(await confirmed(ctx, `Delete ${repo} on GitHub? This cannot be undone.`))) {
      err(ctx, 'not deleted')
      return EXIT.error
    }
    await b.deleteRepo(repo, ctx.args.confirm)
    if (ctx.args.json) json(ctx, { ok: true, message: `${repo} deleted`, repo })
    else out(ctx, `${repo} deleted`)
    return EXIT.ok
  }
  throw new UsageError(`repos: unknown sub-command "${sub}" (list, create, delete)`)
}

/** Runs one CLI invocation and returns the exit code (0 ok, 1 error, 2 pending changes / drift). */
export async function main(argv: string[], io: Io = defaultIo()): Promise<number> {
  let args: Args
  const p = paint(io.isTTY, io.env)
  // Server logs stay quiet on a CLI: warnings and errors go to stderr, OCTOWARDEN_LOG_LEVEL=debug shows GitHub calls.
  setLogLevel(io.env.OCTOWARDEN_LOG_LEVEL ?? 'warn')
  try {
    args = parseCli(argv)
  } catch (e) {
    const wantsJson = argv.includes('--json')
    if (wantsJson) io.stdout(`${JSON.stringify({ ok: false, message: (e as Error).message, code: 'usage' })}\n`)
    else io.stderr(`error: ${(e as Error).message}\nRun ${io.prog} --help for usage.\n`)
    return EXIT.error
  }
  if (args.version) {
    io.stdout(`${VERSION}\n`)
    return EXIT.ok
  }
  if (args.help || !args.command) {
    io.stdout(helpText(io.prog, VERSION))
    return args.command || args.help ? EXIT.ok : EXIT.error
  }
  const serverUrl = args.server ?? io.env.OCTOWARDEN_SERVER
  let cached: Promise<Backend> | undefined
  const backend = () =>
    (cached ??= (async () => {
      if (serverUrl) return serverBackend({ url: serverUrl, token: args.token ?? io.env.OCTOWARDEN_TOKEN, fetch: io.fetch })
      const docs = await loadDocuments(args.files, args.dirs)
      return standaloneBackend(docs, () => (io.github ? Promise.resolve(io.github) : standaloneAuth()))
    })())
  const ctx: Ctx = { args, io, p, backend }
  try {
    switch (args.command) {
      case 'plan':
        return await cmdPlan(ctx)
      case 'apply':
        return await cmdApply(ctx)
      case 'sync':
        return await cmdSync(ctx)
      case 'audit':
        return await cmdAudit(ctx)
      case 'templates':
        return await cmdList(ctx, 'templates')
      case 'sets':
        return await cmdList(ctx, 'sets')
      case 'sections':
        return await cmdSections(ctx)
      case 'export':
        return await cmdExport(ctx)
      case 'import':
        return await cmdImport(ctx)
      case 'repos':
        return await cmdRepos(ctx)
    }
  } catch (e) {
    const code = e instanceof CliError ? e.code : e instanceof UsageError ? 'usage' : 'error'
    const data = e instanceof CliError ? e.data : {}
    if (args.json) json(ctx, { ok: false, message: (e as Error).message, code, ...data })
    else {
      err(ctx, `${p.red('error:')} ${(e as Error).message}`)
      const destructive = (data as { destructive?: { section: string; op: string; target: string }[] }).destructive
      if (destructive?.length) for (const d of destructive) err(ctx, p.red(`  ! ${d.op} ${d.section} ${d.target}`))
      if (!(e instanceof CliError) && !(e instanceof UsageError) && io.env.OCTOWARDEN_DEBUG) err(ctx, String((e as Error).stack))
    }
    return EXIT.error
  }
  return EXIT.error
}
