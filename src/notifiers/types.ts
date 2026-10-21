export type NotifyKind = 'drift' | 'apply_failed' | 'apply_done'

export type NotifyEvent = {
  kind: NotifyKind
  title: string
  text: string
  repo?: string
  url?: string
}

/** One outbound channel. Register in src/notifiers/index.ts; config lives in settings (`notify_<name>_*`). */
export interface Notifier {
  name: string
  title: string
  /** True when configured (setting present and valid). */
  enabled(): Promise<boolean>
  /** Throws with a reason on failure; the registry logs it and never fails the caller. */
  send(event: NotifyEvent): Promise<void>
}
