import type { LogLevel } from './config'

export type { LogLevel }

export interface Logger {
  debug(message: string, ...rest: unknown[]): void
  info(message: string, ...rest: unknown[]): void
  warn(message: string, ...rest: unknown[]): void
  error(message: string, ...rest: unknown[]): void
  /** Logger with a `[name]` prefix; children of children join with `:` (`[github:app]`). */
  child(name: string): Logger
}

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }
let threshold: LogLevel = (Bun.env.LOG_LEVEL as LogLevel) in ORDER ? (Bun.env.LOG_LEVEL as LogLevel) : 'info'

/** Sets the minimum level; settings.ts calls this when `log_level` loads or changes. */
export function setLogLevel(level: string): void {
  if (level in ORDER) threshold = level as LogLevel
}

export function logLevel(): LogLevel {
  return threshold
}

/** Keys whose values never reach a log line, an export or an answer. */
export const REDACT_PATTERN = /token|secret|private_key|password|authorization/i
export const REDACTED = '***'

/** Deep copy with every value under a matching key (or a key in `extraKeys`) replaced by `***`. */
export function redact<T>(value: T, extraKeys: Iterable<string> = []): T {
  const extra = new Set(extraKeys)
  const walk = (v: unknown, depth: number): unknown => {
    if (depth > 32 || v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) return v.map((x) => walk(x, depth + 1))
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      out[k] = REDACT_PATTERN.test(k) || extra.has(k) ? (x === '' || x == null ? x : REDACTED) : walk(x, depth + 1)
    }
    return out
  }
  return walk(value, 0) as T
}

/** postgres://user:pass@host → postgres://***@host */
export function redactUrl(url: string): string {
  return url.replace(/\/\/[^@/]*@/, '//***@')
}

function format(rest: unknown[]): string {
  return rest
    .map((r) => {
      if (r instanceof Error) return `${r.message}\n${r.stack ?? ''}`
      if (typeof r === 'string') return r
      try {
        return JSON.stringify(redact(r))
      } catch {
        return String(r)
      }
    })
    .join(' ')
}

function make(prefix: string): Logger {
  const write = (level: LogLevel, message: string, rest: unknown[]) => {
    if (ORDER[level] < ORDER[threshold]) return
    const tag = prefix ? ` [${prefix}]` : ''
    const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)}${tag} ${message}${rest.length ? ' ' + format(rest) : ''}\n`
    if (level === 'error' || level === 'warn') process.stderr.write(line)
    else process.stdout.write(line)
  }
  return {
    debug: (m, ...r) => write('debug', m, r),
    info: (m, ...r) => write('info', m, r),
    warn: (m, ...r) => write('warn', m, r),
    error: (m, ...r) => write('error', m, r),
    child: (name) => make(prefix ? `${prefix}:${name}` : name),
  }
}

/** Root stdout logger; use `log.child('github')` for a subsystem. */
export const log: Logger = make('')
