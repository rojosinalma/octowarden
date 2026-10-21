import { parseArgs } from 'node:util'
import type { Value, Values } from '../templates/values'

export class UsageError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export const COMMANDS = ['plan', 'apply', 'sync', 'audit', 'templates', 'sets', 'sections', 'export', 'import', 'repos'] as const
export type Command = (typeof COMMANDS)[number]

export type Args = {
  command?: Command
  /** Words after the command (sub-command, repo names, file). */
  rest: string[]
  files: string[]
  dirs: string[]
  server?: string
  token?: string
  sets: string[]
  templates: string[]
  values: Values
  json: boolean
  yes: boolean
  confirm?: string
  help: boolean
  version: boolean
  manifest: boolean
  owner?: string
  name?: string
  visibility?: 'public' | 'private'
  description?: string
}

const OPTIONS = {
  file: { type: 'string', short: 'f', multiple: true },
  dir: { type: 'string', short: 'd', multiple: true },
  server: { type: 'string' },
  token: { type: 'string' },
  set: { type: 'string', short: 's', multiple: true },
  template: { type: 'string', short: 't', multiple: true },
  value: { type: 'string', multiple: true },
  json: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  confirm: { type: 'string' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'V' },
  manifest: { type: 'boolean' },
  owner: { type: 'string' },
  name: { type: 'string' },
  private: { type: 'boolean' },
  public: { type: 'boolean' },
  description: { type: 'string' },
} as const

const KEY = /^[A-Za-z_][A-Za-z0-9_]*$/

/** `k=v`: `true`/`false` become booleans, integers numbers, everything else a string. */
export function parseValue(pair: string): [string, Value] {
  const i = pair.indexOf('=')
  if (i <= 0) throw new UsageError(`--value needs key=value, got "${pair}"`)
  const key = pair.slice(0, i)
  const raw = pair.slice(i + 1)
  if (!KEY.test(key)) throw new UsageError(`value key "${key}": letters, digits and _ only, not starting with a digit`)
  if (raw === 'true' || raw === 'false') return [key, raw === 'true']
  if (/^-?\d{1,15}$/.test(raw)) return [key, Number(raw)]
  return [key, raw]
}

/** Parses argv (without the program name). Throws UsageError for unknown flags, commands or bad values. */
export function parseCli(argv: string[]): Args {
  let parsed
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true, strict: true })
  } catch (err) {
    throw new UsageError((err as Error).message.replace(/^TypeError \[[A-Z_]+\]: /, ''))
  }
  const v = parsed.values
  const [first, ...rest] = parsed.positionals
  if (first !== undefined && !(COMMANDS as readonly string[]).includes(first)) throw new UsageError(`unknown command "${first}"; run --help for the list`)
  if (v.private && v.public) throw new UsageError('--private and --public exclude each other')
  const values: Values = {}
  for (const pair of v.value ?? []) {
    const [k, val] = parseValue(pair)
    values[k] = val
  }
  return {
    command: first as Command | undefined,
    rest,
    files: v.file ?? [],
    dirs: v.dir ?? [],
    server: v.server,
    token: v.token,
    sets: v.set ?? [],
    templates: v.template ?? [],
    values,
    json: Boolean(v.json),
    yes: Boolean(v.yes),
    confirm: v.confirm,
    help: Boolean(v.help),
    version: Boolean(v.version),
    manifest: Boolean(v.manifest),
    owner: v.owner,
    name: v.name,
    visibility: v.public ? 'public' : v.private ? 'private' : undefined,
    description: v.description,
  }
}

const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/

export function checkRepo(name: string | undefined, what = 'repo'): string {
  if (!name) throw new UsageError(`${what} missing: give owner/name`)
  if (!REPO.test(name)) throw new UsageError(`${what} must be owner/name, got "${name}"`)
  return name
}
