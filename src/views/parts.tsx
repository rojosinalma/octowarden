import { Html, type PropsWithChildren } from '@kitajs/html'

/** Escape untrusted text for HTML content. Attributes are escaped by the JSX runtime already. */
export const e = (value: unknown): string => Html.escapeHtml(String(value ?? ''))

/** JSON for a `<script type="application/json">` island: `<` escaped so no `</script>` can close it. */
export const jsonIsland = (value: unknown): string => JSON.stringify(value ?? null).replace(/</g, '\\u003c')

/** Sprite icon: `<set>-<name>` ids as rendered by `tailor apply --icons`. */
export const Icon = ({ id, size }: { id: string; size?: 'xs' | 'sm' | 'lg' | 'xl' }) => (
  <svg class="t-icon" aria-hidden="true" data-size={size}>
    <use href={`/tailor/icons.svg#${id}`} />
  </svg>
)

const fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })

/** `<time>` upgraded client-side to a relative label; the absolute date stays in the markup. */
export const RelTime = ({ at }: { at: string | null | undefined }) => {
  if (!at) return <span class="t-muted">never</span>
  const date = new Date(at)
  const label = Number.isNaN(date.getTime()) ? at : `${fmt.format(date)} UTC`
  return (
    <time class="t-time" data-relative datetime={at} safe>
      {label}
    </time>
  )
}

export const Empty = ({ icon, title, text, size, children }: PropsWithChildren<{ icon: string; title: string; text: string; size?: 'sm' }>) => (
  <div class="t-empty" data-size={size}>
    <svg class="t-icon t-empty-icon" aria-hidden="true">
      <use href={`/tailor/icons.svg#${icon}`} />
    </svg>
    <h3 class="t-empty-title" safe>
      {title}
    </h3>
    <p safe>{text}</p>
    {children ? <div class="t-empty-actions">{children}</div> : null}
  </div>
)

/** Info popover next to a label. */
export const Help = ({ label, tone = 'info', children }: PropsWithChildren<{ label: string; tone?: 'accent' | 'info' | 'danger' }>) => (
  <span class="t-help" data-tone={tone}>
    <button class="t-help-btn" type="button" aria-expanded="false" aria-label={`About ${label}`}>
      {tone === 'accent' ? '?' : tone === 'danger' ? '!' : 'i'}
    </button>
    <div class="t-help-box" hidden>
      {children}
    </div>
  </span>
)

export const PageHeader = ({ title, lead, back, children }: PropsWithChildren<{ title: string; lead?: string; back?: { href: string; label: string } }>) => (
  <header class="t-page-header">
    {back ? (
      <a class="t-page-back" href={back.href} aria-label={back.label}>
        <Icon id="bi-arrow-left" />
      </a>
    ) : null}
    <h1 class="t-page-title" safe>
      {title}
    </h1>
    {lead ? (
      <span class="t-page-lead" safe>
        {lead}
      </span>
    ) : null}
    {children ? <div class="t-page-actions">{children}</div> : null}
  </header>
)

const DRIFT_TONE: Record<string, string> = { clean: 'success', drift: 'warning', error: 'danger', unknown: 'neutral' }
const DRIFT_LABEL: Record<string, string> = { clean: 'in sync', drift: 'drift', error: 'error', unknown: 'not audited' }

export const DriftBadge = ({ state }: { state: string }) => (
  <span class="t-badge" data-tone={DRIFT_TONE[state] ?? 'neutral'} data-drift={state} safe>
    {DRIFT_LABEL[state] ?? state}
  </span>
)

const OUTCOME_TONE: Record<string, string> = {
  applied: 'success',
  clean: 'success',
  ok: 'success',
  planned: 'info',
  info: 'info',
  running: 'info',
  skipped: 'neutral',
  drift: 'warning',
  partial: 'warning',
  failed: 'danger',
}

export const OutcomeBadge = ({ outcome }: { outcome: string }) => (
  <span class="t-badge" data-tone={OUTCOME_TONE[outcome] ?? 'neutral'} safe>
    {outcome}
  </span>
)

export const VisibilityBadge = ({ visibility }: { visibility: string }) => (
  <span class="t-badge" data-tone={visibility === 'public' ? 'info' : 'neutral'} data-variant="outline">
    <Icon id={visibility === 'public' ? 'bi-globe' : 'bi-lock'} />
    <span safe>{visibility}</span>
  </span>
)

/** Brand mark for the navbar, drawn with tokens (the standalone favicon carries literal hex). */
export const BrandMark = () => (
  <svg class="t-icon brand-mark" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    <circle cx="12" cy="11" r="2.5" fill="var(--t-success)" stroke="none" />
  </svg>
)

export const plural = (n: number, one: string, many = `${one}s`) => `${String(n)} ${n === 1 ? one : many}`

/** Lowercase slug as stored names require (`nameSchema`): letters, digits, dashes, max 63. */
export const slugify = (text: string) =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
