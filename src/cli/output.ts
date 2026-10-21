import type { ApplyReport, Drift, Plan } from '../engine/types'
import type { Change } from '../sections/types'

export type Paint = {
  on: boolean
  green(s: string): string
  yellow(s: string): string
  red(s: string): string
  dim(s: string): string
  bold(s: string): string
}

/** ANSI colours only on a terminal; NO_COLOR always wins, FORCE_COLOR=1 forces them on a pipe. */
export function paint(isTTY: boolean, env: Record<string, string | undefined>): Paint {
  const on = env.NO_COLOR === undefined && (env.FORCE_COLOR === '1' || (isTTY && env.TERM !== 'dumb'))
  const wrap = (code: string) => (s: string) => (on ? `\x1b[${code}m${s}\x1b[0m` : s)
  return { on, green: wrap('32'), yellow: wrap('33'), red: wrap('31'), dim: wrap('2'), bold: wrap('1') }
}

const short = (v: unknown, max = 120): string => {
  const s = v === undefined ? '—' : typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v)
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export function changeLine(c: Change, p: Paint): string {
  const mark = c.destructive ? p.red(p.bold(' ! destructive')) : ''
  const where = `${c.section} ${c.target}`
  switch (c.op) {
    case 'create':
      return `${p.green(`  + ${where}`)}  ${short(c.after)}${mark}`
    case 'delete':
      return `${p.red(`  - ${where}`)}  ${p.dim(short(c.before))}${mark}`
    case 'noop':
      return p.dim(`  = ${where}`)
    default:
      return `${p.yellow(`  ~ ${where}`)}  ${p.dim(short(c.before))} → ${short(c.after)}${mark}`
  }
}

export function planText(plan: Pick<Plan, 'changes' | 'skipped' | 'destructive'> & { repo: { full_name: string } | string }, p: Paint): string {
  const name = typeof plan.repo === 'string' ? plan.repo : plan.repo.full_name
  const head = plan.changes.length
    ? `${p.bold(name)}: ${plan.changes.length} change${plan.changes.length === 1 ? '' : 's'}${plan.destructive ? p.red(` (${plan.destructive} destructive)`) : ''}`
    : `${p.bold(name)}: ${p.green('in sync')}`
  const lines = [head, ...plan.changes.map((c) => changeLine(c, p))]
  for (const s of plan.skipped) lines.push(p.dim(`  · skipped ${s.section}${s.template ? ` (${s.template})` : ''}: ${s.reason}`))
  return lines.join('\n')
}

export function reportText(r: Pick<ApplyReport, 'repo' | 'status' | 'results' | 'applied' | 'failed' | 'skipped'>, p: Paint): string {
  const tone = r.status === 'ok' ? p.green : r.status === 'partial' ? p.yellow : p.red
  const lines = [`${p.bold(r.repo)}: ${tone(r.status)} — ${r.applied} applied, ${r.failed} failed, ${r.skipped.length} skipped`]
  for (const x of r.results) {
    const t = x.outcome === 'applied' ? p.green : x.outcome === 'failed' ? p.red : p.dim
    lines.push(`  ${t(x.outcome.padEnd(7))} ${x.change.section} ${x.change.target}${x.message ? p.dim(`  ${x.message}`) : ''}`)
  }
  return lines.join('\n')
}

export function driftText(d: Pick<Drift, 'repo' | 'changes' | 'message'> & { state: string }, p: Paint): string {
  const tone = d.state === 'clean' ? p.green : d.state === 'drift' ? p.yellow : p.red
  const lines = [`${p.bold(d.repo)}: ${tone(d.state)}${d.message ? p.dim(` — ${d.message}`) : ''}`]
  for (const c of d.changes) lines.push(changeLine(c, p))
  return lines.join('\n')
}

/** Columns padded to the widest cell (no colour inside cells). */
export function table(rows: string[][]): string {
  if (!rows.length) return ''
  const widths = rows[0]!.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)))
  return rows.map((r) => r.map((c, i) => (i === r.length - 1 ? c : c.padEnd(widths[i]!))).join('  ').trimEnd()).join('\n')
}
