import { resolve, sep } from 'node:path'
import { authStatus } from '../../auth/providers'
import { errorResult } from '../../lib/json'
import { log } from '../../lib/log'
import { allSettings } from '../../lib/settings'
import { VERSION } from '../../lib/version'
import { peekGitHubStatus } from '../../github/status'
import { gapCount } from '../../views/github'
import { uiCtx, type Ctx } from '../../services'
import { Layout, type NavKey } from '../../views/layout'
import { siblingView } from '../../lib/siblings'
import { Empty, Icon } from '../../views/parts'
import type { AuthView } from '../../views/types'

export const logger = log.child('http')
export const publicDir = resolve(import.meta.dir, '../../../public')

const headFile = Bun.file(resolve(publicDir, 'tailor/tailor-head.html'))
let tailorHead: string | undefined

/** `tailor-head.html` (vendored by `tailor apply`), read once. */
export async function head(): Promise<string> {
  tailorHead ??= (await headFile.exists()) ? await headFile.text() : '<!-- run `tailor apply` to vendor the design system -->'
  return tailorHead
}

export const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8' } })

/** Ctx of a UI request: source `ui`, actor from the `ui_actor_header` request header. */
export const ctxOf = (request: Request): Promise<Ctx> => uiCtx(request.headers)

export async function auth(): Promise<AuthView> {
  return authStatus().catch(() => ({ mode: 'none', source: 'none' }))
}

/** Full page in the layout, with the stored theme. */
export async function page(active: NavKey, title: string, body: JSX.Element | Promise<JSX.Element>, opts: { subnav?: { href: string; label: string; icon: string }[]; status?: number } = {}): Promise<Response> {
  const [settings, tailor, content, siblings] = await Promise.all([allSettings().catch(() => ({}) as Record<string, string>), head(), body, siblingView()])
  const doc = await (
    <Layout
      title={title}
      active={active}
      tailorHead={tailor}
      version={VERSION}
      theme={{ skin: settings['ui_skin'], palette: settings['ui_palette'], mode: settings['ui_mode'] }}
      subnav={opts.subnav}
      githubGaps={gapCount(peekGitHubStatus())}
      siblings={siblings}
    >
      {content}
    </Layout>
  )
  return html(doc, opts.status)
}

/** A page handler that renders failures inside the layout with the reason (404 for unknown names). */
export function guarded(active: NavKey, fn: () => Promise<Response>): Promise<Response> {
  return fn().catch((err) => {
    const { status, body } = errorResult(err)
    return page(
      active,
      status === 404 ? 'Not found' : 'Error',
      <Empty icon={status === 404 ? 'bi-search' : 'bi-exclamation-triangle'} title={status === 404 ? 'Not found' : 'Something failed'} text={body.message}>
        <a class="t-btn" href="/">
          <Icon id="bi-arrow-left" /> Back to repos
        </a>
      </Empty>,
      { status },
    )
  })
}

/** JSON action answer: `{ok, message, …}`; errors keep their status and reason. */
export async function action(fn: () => Promise<{ message: string } & Record<string, unknown>>): Promise<Response> {
  try {
    const { message, ...rest } = await fn()
    return Response.json({ ok: true, message, ...rest })
  } catch (err) {
    const { status, body } = errorResult(err)
    return Response.json(body, { status })
  }
}

/** One file from `public/`; anything resolving outside it is a 404. */
export async function serveStatic(rel: string): Promise<Response> {
  let decoded: string
  try {
    decoded = decodeURIComponent(rel)
  } catch {
    return new Response('Bad path', { status: 400 })
  }
  if (decoded.includes('\0') || decoded.split(/[\\/]+/).some((seg) => seg === '..')) return new Response('Not found', { status: 404 })
  const full = resolve(publicDir, decoded)
  if (!full.startsWith(publicDir + sep)) return new Response('Not found', { status: 404 })
  const file = Bun.file(full)
  if (!(await file.exists())) return new Response('Not found', { status: 404 })
  const cache = full.includes(`${sep}tailor${sep}`) ? 'public, max-age=3600' : 'no-cache'
  return new Response(file, { headers: { 'cache-control': cache } })
}

/** Request JSON body as a plain object (empty object when absent or not JSON). */
export async function bodyOf(request: Request): Promise<Record<string, unknown>> {
  try {
    const v = await request.json()
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export const str = (v: unknown): string | undefined => (typeof v === 'string' && v !== '' ? v : undefined)
export const strs = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : undefined)
