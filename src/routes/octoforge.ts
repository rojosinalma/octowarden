import type { AnyElysia } from 'elysia'
import { z } from 'zod'
import manifest from '../../octoforge.json'
import { appCredentials } from '../auth/providers/app'
import { authStatus } from '../auth/providers'
import { verifyCredential } from '../auth/verify'
import { contractPermissions, githubStatus as accessStatus } from '../github/status'
import { dbHandle } from '../db'
import { adoptDatabase, dropAdoption } from '../lib/adopt'
import { config } from '../lib/config'
import { recordEvent } from '../lib/events'
import { jsonOk, ValidationError } from '../lib/json'
import { log } from '../lib/log'
import { getSetting, setSetting, type SettingKey } from '../lib/settings'
import { VERSION } from '../lib/version'
import { requireBearer } from './guard'

const logger = log.child('octoforge')
const ACTOR = { source: 'api' as const, actor: 'octoforge' }
const BODY_MAX = 64 * 1024

const numericId = z.union([z.number().int().positive(), z.string().regex(/^\d{1,20}$/)]).transform(String)
const githubBody = z.discriminatedUnion('mode', [
  z.strictObject({ mode: z.literal('pat'), token: z.string().min(1).max(500) }),
  z.strictObject({
    mode: z.literal('app'),
    app_id: numericId,
    private_key: z.string().min(1).max(16_384),
    webhook_secret: z.string().max(256).optional(),
    installation_id: numericId.optional(),
  }),
])
const adoptBody = z.strictObject({ url: z.string().min(1).max(2048), schema: z.string().min(1).max(63), copy: z.boolean().optional() })

const PAT_KEYS: SettingKey[] = ['github_token']
const APP_KEYS: SettingKey[] = ['github_app_id', 'github_app_private_key', 'github_app_installation_id', 'github_webhook_secret']

/** JSON body read after the guard (routes use `parse: 'none'`, so an unauthenticated call learns nothing about bodies). */
async function jsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (text.length > BODY_MAX) throw new ValidationError('body too large')
  try {
    return text ? JSON.parse(text) : {}
  } catch {
    throw new ValidationError('request body is not valid JSON')
  }
}

/** Contract sources are env | octoforge | none: a credential set locally (Settings, gh CLI) counts as `env`. */
function contractSource(s: string): 'env' | 'octoforge' | 'none' {
  if (s === 'octoforge') return 'octoforge'
  return s === 'none' ? 'none' : 'env'
}

async function githubStatus() {
  const s = await authStatus()
  const app = s.mode === 'app' ? await appCredentials() : undefined
  return {
    mode: s.mode === 'none' ? null : s.mode,
    source: contractSource(s.source),
    ...(app ? { app_id: Number(app.appId) } : {}),
    ...(s.login ? { login: s.login } : {}),
    ...(s.mode === 'none' ? {} : contractPermissions(await accessStatus())),
  }
}

/**
 * Octoforge member contract v1 under `/api/octoforge` (docs/octoforge.md). With OCTOFORGE_TOKEN unset every route
 * answers 404; otherwise every route but `GET /manifest` needs `Authorization: Bearer <OCTOFORGE_TOKEN>` (401).
 * Secrets go to settings and never into an answer or a log line.
 */
export function register<A extends AnyElysia>(app: A): A {
  const enabled = requireBearer(() => config().octoforgeToken, { name: 'OCTOFORGE_TOKEN', unsetStatus: 404 })
  const exists = ({ set }: { set: { status?: number | string } }) => {
    if (config().octoforgeToken) return undefined
    set.status = 404
    return { ok: false, message: 'not found', code: 'not_found' }
  }
  const a = app as AnyElysia
  a.group('/api/octoforge', (g: AnyElysia) =>
    g
      .get('/manifest', () => manifest, { beforeHandle: exists as never })
      .guard({ beforeHandle: enabled as never }, (r: AnyElysia) =>
        r
          .get('/status', async () =>
            jsonOk('ok', {
              contract: manifest.contract,
              version: VERSION,
              github: await githubStatus(),
              database: { engine: dbHandle().engine, ...(dbHandle().schema ? { schema: dbHandle().schema } : {}), source: config().databaseSource },
            }),
          )
          .put(
            '/github',
            async ({ request }) => {
              const body = githubBody.parse(await jsonBody(request))
              const who = await verifyCredential(body)
              if (body.mode === 'pat') {
                await setSetting('github_token', body.token)
              } else {
                await setSetting('github_app_id', body.app_id)
                await setSetting('github_app_private_key', body.private_key)
                await setSetting('github_app_installation_id', body.installation_id ?? '')
                await setSetting('github_webhook_secret', body.webhook_secret ?? '')
              }
              await setSetting('github_auth_mode', body.mode)
              await setSetting('github_credential_source', 'octoforge')
              const name = 'login' in who ? who.login : 'app_slug' in who ? who.app_slug : undefined
              const message = body.mode === 'pat' ? `token of ${name ?? 'unknown user'} stored and in use` : `GitHub App ${name ?? body.app_id} stored and in use`
              logger.info(`github credential delivered (${body.mode}${name ? `, ${name}` : ''})`)
              await recordEvent({ ...ACTOR, action: 'octoforge.github', outcome: 'info', message })
              return jsonOk(message, { ...who, restart_required: false })
            },
            { parse: 'none' },
          )
          .delete('/github', async () => {
            const delivered = (await getSetting('github_credential_source')) === 'octoforge'
            if (delivered) {
              const mode = await getSetting('github_auth_mode')
              for (const k of mode === 'app' ? APP_KEYS : mode === 'pat' ? PAT_KEYS : [...PAT_KEYS, ...APP_KEYS]) await setSetting(k, '')
              await setSetting('github_credential_source', '')
              await setSetting('github_auth_mode', 'auto')
              logger.info('delivered github credential removed')
              await recordEvent({ ...ACTOR, action: 'octoforge.github.drop', outcome: 'info', message: 'delivered GitHub credential removed' })
            }
            const s = await githubStatus()
            const back = s.mode ? `the ${s.mode} credential from ${s.source}` : 'no GitHub credential'
            return jsonOk(delivered ? `delivered credential removed; using ${back}` : `no delivered credential; using ${back}`, { removed: delivered, restart_required: false })
          })
          .post(
            '/database/adopt',
            async ({ request }) => {
              const body = adoptBody.parse(await jsonBody(request))
              const copy = body.copy ?? true
              const { tables } = await adoptDatabase({ url: body.url, schema: body.schema, copy })
              await recordEvent({ ...ACTOR, action: 'octoforge.database.adopt', outcome: 'info', diff: { copy, tables }, message: `database adopted (schema ${body.schema})` })
              return jsonOk(`database adopted${copy ? ` (${Object.keys(tables).length} tables copied)` : ''}; restart to use it`, { tables, restart_required: true })
            },
            { parse: 'none' },
          )
          .delete('/database', async () => {
            const { removed } = dropAdoption()
            await recordEvent({ ...ACTOR, action: 'octoforge.database.drop', outcome: 'info', message: removed ? 'adoption file removed' : 'no adoption file' })
            return jsonOk(removed ? 'adopted database setting removed; restart to use DATABASE_URL again' : 'no adopted database setting', { removed, restart_required: true })
          }),
      ),
  )
  return app
}
