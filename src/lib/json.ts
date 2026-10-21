import { ZodError } from 'zod'
import { log } from './log'

export type JsonOk<T extends object = object> = { ok: true; message: string } & T
export type JsonErr<T extends object = object> = { ok: false; message: string; code: string } & T

/** Error with an HTTP status and a stable code; routes map it 1:1. Everything else becomes a 500. */
export class AppError extends Error {
  constructor(
    message: string,
    readonly status: number = 500,
    readonly code: string = codeFor(status),
    readonly data: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/** Input failed validation (422). */
export class ValidationError extends AppError {
  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message, 422, 'invalid', data)
    this.name = 'ValidationError'
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super(message, 404, 'not_found')
    this.name = 'NotFoundError'
  }
}

export class ConflictError extends AppError {
  constructor(message: string, data: Record<string, unknown> = {}) {
    super(message, 409, 'conflict', data)
    this.name = 'ConflictError'
  }
}

/** A dependency (GitHub credentials, API_TOKEN, DB) is missing or down (503). */
export class UnavailableError extends AppError {
  constructor(message: string) {
    super(message, 503, 'unavailable')
    this.name = 'UnavailableError'
  }
}

const CODES: Record<number, string> = {
  400: 'bad_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  422: 'invalid',
  429: 'rate_limited',
  500: 'internal',
  502: 'upstream',
  503: 'unavailable',
}

export function codeFor(status: number): string {
  return CODES[status] ?? (status >= 500 ? 'internal' : 'bad_request')
}

/** `{ ok: true, message, ...data }` — every action answer. */
export function jsonOk<T extends object = object>(message = 'ok', data?: T): JsonOk<T> {
  return { ok: true, message, ...(data ?? ({} as T)) }
}

/** `{ ok: false, message, code, ...data }` body without a status (MCP, CLI). */
export function errBody<T extends object = object>(message: string, code: string, data?: T): JsonErr<T> {
  return { ok: false, message, code, ...(data ?? ({} as T)) }
}

/** JSON error Response: `{ ok: false, message, code, ...data }` with `status` (400 bad request, 422 validation, 5xx system). */
export function jsonErr(message: string, status = 400, data?: Record<string, unknown>): Response {
  return Response.json(errBody(message, codeFor(status), data), { status })
}

/** One line from a ZodError: `spec.sections.settings.has_wiki: Invalid input: expected boolean`. */
export function zodMessage(err: ZodError): string {
  const first = err.issues[0]
  if (!first) return 'invalid input'
  const path = first.path.map(String).join('.')
  return path ? `${path}: ${first.message}` : first.message
}

const logger = log.child('http')

/**
 * Classifies any thrown value: AppError keeps its status/code; ZodError → 422 with `issues`;
 * anything else → 500 "internal error" with the stack logged (never sent).
 */
export function errorResult(err: unknown): { status: number; body: JsonErr<Record<string, unknown>> } {
  if (err instanceof AppError) return { status: err.status, body: errBody(err.message, err.code, err.data) }
  if (err instanceof ZodError) {
    const issues = err.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
    return { status: 422, body: errBody(zodMessage(err), 'invalid', { issues }) }
  }
  logger.error('unhandled error', err instanceof Error ? err : String(err))
  return { status: 500, body: errBody('internal error', 'internal') }
}

/** errorResult as a Response. */
export function jsonFromError(err: unknown): Response {
  const { status, body } = errorResult(err)
  return Response.json(body, { status })
}

/** One readable line from an Elysia VALIDATION error: `body repo: Expected string`. */
export function validationMessage(error: unknown): string {
  const e = error as { type?: string; all?: { path?: string; summary?: string; message?: string }[]; message?: string }
  const first = e.all?.[0]
  if (first) {
    const where = [e.type, first.path?.replace(/^\//, '')].filter(Boolean).join(' ')
    const what = first.summary ?? first.message ?? 'invalid value'
    return where ? `${where}: ${what}` : what
  }
  const line = e.message?.split('\n')[0]?.trim()
  return line && !line.startsWith('{') ? line : 'invalid request'
}
