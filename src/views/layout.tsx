import { type PropsWithChildren } from '@kitajs/html'
import type { SiblingView } from '../lib/siblings'
import { BrandMark, Icon } from './parts'

export type NavKey = 'repos' | 'templates' | 'sets' | 'audit' | 'settings'

export const NAV: { key: NavKey; href: string; label: string; icon: string }[] = [
  { key: 'repos', href: '/', label: 'Repos', icon: 'bi-github' },
  { key: 'templates', href: '/templates', label: 'Templates', icon: 'bi-file-earmark-code' },
  { key: 'sets', href: '/sets', label: 'Sets', icon: 'bi-collection' },
  { key: 'audit', href: '/audit', label: 'Audit', icon: 'bi-clock-history' },
  { key: 'settings', href: '/settings', label: 'Settings', icon: 'bi-gear' },
]

export type Theme = { skin?: string; palette?: string; mode?: string }

export type LayoutProps = PropsWithChildren<{
  title: string
  active: NavKey
  /** `tailor-head.html`, vendored by `tailor apply`; read once by the route. */
  tailorHead: string
  version: string
  /** Settings `ui_skin`, `ui_palette`, `ui_mode`, seeded into the flash cache before the first paint. */
  theme?: Theme
  /** Extra sidebar entries under the active item (settings sections). */
  subnav?: { href: string; label: string; icon: string }[]
  /** Definite GitHub permission gaps (cached check): a danger counter on Settings and its GitHub entry. */
  githubGaps?: number
  /** Octoforge sibling list: a switcher to Octoforge and every member (absent = not part of an Octoforge). */
  siblings?: SiblingView
}>

const SAFE_ID = /^[a-z0-9-]+$/
const PROJECT = 'octowarden'

/**
 * Pre-paint: the server's theme choice wins over a stale flash cache, so every browser shows the stored setting.
 * Runs before tailor's head snippet reads localStorage.
 */
export const seedTheme = (theme: Theme) =>
  `(function(){try{var t=${JSON.stringify(Object.fromEntries(Object.entries(theme).filter(([, v]) => typeof v === 'string' && SAFE_ID.test(v))))};for(var k in t){localStorage.setItem('${PROJECT}.'+k,t[k])}}catch(e){}})();`

const SiblingIcon = ({ src }: { src?: string }) =>
  src ? <img class="t-icon sibling-icon" src={src} alt="" width="16" height="16" loading="lazy" /> : <Icon id="bi-box-arrow-up-right" />

/** Links to Octoforge and the other members; the current tool is marked, not linked. */
const SiblingNav = ({ s }: { s: SiblingView }) => (
  <>
    <li class="t-sidebar-divider"></li>
    <li class="t-sidebar-group">
      Octoforge{' '}
      {s.stale ? (
        <span class="t-badge" data-size="xs" data-tone="warning" data-tip="Octoforge has not refreshed this list for a while">
          stale
        </span>
      ) : null}
    </li>
    <li>
      <a class="t-sidebar-item" href={s.forge.url} rel="noopener" data-sibling="octoforge">
        <SiblingIcon src={s.forge.icon} />
        <span class="t-sidebar-item-name" safe>
          {s.forge.title}
        </span>
      </a>
    </li>
    {s.members.map((m) =>
      m.self ? (
        <li>
          <span class="t-sidebar-item sibling-self" aria-current="true" data-sibling={m.name}>
            <SiblingIcon src={m.icon} />
            <span class="t-sidebar-item-name" safe>
              {m.title}
            </span>
            <span class="t-badge" data-size="xs" data-tone="neutral">
              this app
            </span>
          </span>
        </li>
      ) : (
        <li>
          <a class="t-sidebar-item" href={m.url} rel="noopener" data-sibling={m.name}>
            <SiblingIcon src={m.icon} />
            <span class="t-sidebar-item-name" safe>
              {m.title}
            </span>
          </a>
        </li>
      ),
    )}
  </>
)

const GapCounter = ({ n }: { n?: number }) =>
  n ? (
    <span class="t-counter" data-tone="danger" data-github-gaps={String(n)} data-tip={`GitHub access lacks ${String(n)} permission${n === 1 ? '' : 's'}`}>
      {String(n)}
    </span>
  ) : null

export const Layout = ({ title, active, tailorHead, version, theme = {}, subnav, githubGaps, siblings, children }: LayoutProps) => (
  <>
    {'<!doctype html>'}
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title safe>{`${title} · octowarden`}</title>
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <script>{seedTheme(theme)}</script>
        {tailorHead}
        <link rel="stylesheet" href="/public/app.css" />
      </head>
      <body>
        <div class="t-shell">
          <header class="t-navbar t-shell-nav">
            <a class="t-navbar-brand" href="/">
              <BrandMark />
              octowarden
            </a>
            <div class="t-navbar-end">
              <span class="t-dot" data-status="muted" id="live-dot" data-tip="Live updates: connecting"></span>
            </div>
          </header>
          <aside class="t-shell-side">
            <nav class="t-sidebar" aria-label="Main">
              <ul>
                <li class="t-sidebar-group">Manage</li>
                {NAV.filter((n) => n.key !== 'settings').map((n) => (
                  <li>
                    <a class="t-sidebar-item" href={n.href} aria-current={n.key === active ? 'page' : undefined}>
                      <Icon id={n.icon} />
                      <span class="t-sidebar-item-name">{n.label}</span>
                    </a>
                  </li>
                ))}
                <li class="t-sidebar-divider"></li>
                <li>
                  <a class="t-sidebar-item" href="/settings" aria-current={active === 'settings' && !subnav ? 'page' : undefined}>
                    <Icon id="bi-gear" />
                    <span class="t-sidebar-item-name">Settings</span>
                    {subnav ? null : <GapCounter n={githubGaps} />}
                  </a>
                  {subnav ? (
                    <ul class="t-sidebar-nested" id="settings-nav">
                      {subnav.map((s) => (
                        <li>
                          <a class="t-sidebar-item" href={s.href}>
                            <Icon id={s.icon} />
                            <span class="t-sidebar-item-name" safe>
                              {s.label}
                            </span>
                            {s.href.endsWith('#github') ? <GapCounter n={githubGaps} /> : null}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
                {siblings ? <SiblingNav s={siblings} /> : null}
              </ul>
            </nav>
          </aside>
          <main class="t-shell-main t-page">{children}</main>
          <footer class="t-footer t-shell-foot">
            <a class="t-footer-repo" href="https://github.com/rojosinalma/octowarden" data-tip="Repository" aria-label="Repository">
              <Icon id="bi-github" />
            </a>
            <div class="t-footer-end">
              <div data-tailor-pickers="mode"></div>
              <span class="t-footer-version" safe>
                {`v${version}`}
              </span>
            </div>
          </footer>
        </div>
        <div class="t-toasts" id="t-toasts" aria-live="polite" aria-atomic="false"></div>
        <dialog class="t-dialog" id="t-confirm" data-variant="confirm" data-tone="danger" aria-labelledby="t-confirm-title">
          <div class="t-dialog-header">
            <h2 class="t-dialog-title" id="t-confirm-title">
              <Icon id="bi-exclamation-triangle" />
              <span>Are you sure?</span>
            </h2>
            <button class="t-dialog-close" aria-label="Close" data-dialog-close>
              ×
            </button>
          </div>
          <div class="t-dialog-body" id="t-confirm-body"></div>
          <div class="t-dialog-footer">
            <button class="t-btn" data-dialog-close>
              Cancel
            </button>
            <button class="t-btn" data-variant="danger" id="t-confirm-ok">
              Confirm
            </button>
          </div>
        </dialog>
        <TypedConfirm />
        <script src="/public/app.js" defer></script>
      </body>
    </html>
  </>
)

/** One dialog for every destructive action that needs the exact name typed (repo full name, template, set). */
const TypedConfirm = () => (
  <dialog class="t-dialog" id="typed-confirm" data-tone="danger" data-size="sm" aria-labelledby="typed-confirm-title">
    <form class="t-form" method="dialog" novalidate>
      <div class="t-dialog-header">
        <h2 class="t-dialog-title" id="typed-confirm-title">
          <Icon id="bi-exclamation-triangle" />
          <span data-role="title">Confirm</span>
        </h2>
        <button class="t-dialog-close" type="button" aria-label="Close" data-dialog-close>
          ×
        </button>
      </div>
      <div class="t-dialog-body t-stack" data-gap="3">
        <div data-role="body"></div>
        <div class="t-field">
          <label class="t-label" for="typed-confirm-input">
            Type <code data-role="expect"></code> to confirm
          </label>
          <input class="t-input t-mono" id="typed-confirm-input" autocomplete="off" spellcheck="false" />
        </div>
      </div>
      <div class="t-dialog-footer">
        <button class="t-btn" type="button" data-dialog-close>
          Cancel
        </button>
        <button class="t-btn" type="submit" data-variant="danger" data-role="ok" disabled>
          Delete
        </button>
      </div>
    </form>
  </dialog>
)
