/** ISO-8601 UTC timestamp, the one format stored in every table. */
export function nowIso(): string {
  return new Date().toISOString()
}

/** Time-sortable UUIDv7, the id of every row that needs one. */
export function newId(): string {
  return Bun.randomUUIDv7()
}

/** Parses a JSON text column; `fallback` when null, empty or broken. */
export function parseJson<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null)
}
