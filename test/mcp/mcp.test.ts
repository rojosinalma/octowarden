import { beforeEach, describe, expect, test } from 'bun:test'
import { createApp } from '../../src/app'
import { closeAllSessions, sessionCount } from '../../src/mcp'
import { tools } from '../../src/mcp/tools'
import { fresh, REPO } from '../core/helpers'

const TOKEN = 'test-api-token'
const EXPECTED = [
  'health', 'list_sections', 'list_templates', 'get_template', 'upsert_template', 'delete_template', 'list_sets', 'get_set', 'upsert_set',
  'delete_set', 'list_repos', 'get_repo', 'assign_sets', 'repo_lookups', 'plan', 'apply', 'bulk', 'audit', 'get_run', 'list_runs',
  'list_events', 'export_yaml', 'import_yaml', 'get_settings', 'set_setting', 'create_repo', 'delete_repo',
]

let app: ReturnType<typeof createApp>
beforeEach(async () => {
  await closeAllSessions()
  await fresh()
  app = createApp()
})

/** One JSON-RPC call; parses the JSON or the single SSE `data:` line the transport answers with. */
async function rpc(body: unknown, session?: string, token: string | null = TOKEN): Promise<{ status: number; session?: string; json: any }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }
  if (token) headers.authorization = `Bearer ${token}`
  if (session) headers['mcp-session-id'] = session
  const res = await app.handle(new Request('http://localhost/mcp', { method: 'POST', headers, body: JSON.stringify(body) }))
  const text = await res.text()
  const data = text.split('\n').find((l) => l.startsWith('data: '))
  let json: any
  try {
    json = JSON.parse(data ? data.slice(6) : text)
  } catch {
    json = text
  }
  return { status: res.status, session: res.headers.get('mcp-session-id') ?? undefined, json }
}

async function init(): Promise<string> {
  const r = await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } })
  expect(r.status).toBe(200)
  await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, r.session)
  return r.session!
}

describe('mcp', () => {
  test('bearer: 401 wrong token', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, undefined, 'nope')).status).toBe(401)
  })

  test('every tool is listed with its annotations', async () => {
    expect(tools.map((t) => t.name).sort()).toEqual([...EXPECTED].sort())
    const s = await init()
    expect(sessionCount()).toBe(1)
    const r = await rpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, s)
    const listed = r.json.result.tools as { name: string; annotations: { destructiveHint: boolean }; description: string }[]
    expect(listed.map((t) => t.name).sort()).toEqual([...EXPECTED].sort())
    expect(listed.find((t) => t.name === 'delete_repo')!.annotations.destructiveHint).toBe(true)
    expect(listed.find((t) => t.name === 'delete_repo')!.description).toContain('confirm')
  })

  test('calls: upsert a template, plan, a refused confirm', async () => {
    const s = await init()
    const call = async (name: string, args: Record<string, unknown>) => (await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, s)).json.result
    let r = await call('upsert_template', { yaml: 'apiVersion: octowarden/v1\nkind: Template\nmetadata: {name: wiki}\nspec: {sections: {settings: {has_wiki: true}}}' })
    expect(r.isError).toBeUndefined()
    expect(JSON.parse(r.content[0].text).created).toBe(true)
    r = await call('plan', { repo: REPO, templates: ['wiki'] })
    expect(JSON.parse(r.content[0].text).plan.changes[0]).toMatchObject({ section: 'settings', target: 'has_wiki', after: true })
    r = await call('delete_template', { name: 'wiki', confirm: 'nope' })
    expect(r.isError).toBe(true)
    expect(JSON.parse(r.content[0].text).code).toBe('confirm_required')
    r = await call('list_events', { source: 'mcp', outcome: 'info' })
    expect(JSON.parse(r.content[0].text).events[0]).toMatchObject({ actor: 'mcp', action: 'template.create' })
    r = await call('health', {})
    const health = JSON.parse(r.content[0].text)
    expect(health).toMatchObject({ ok: true, db: 'ok', github_access: { mode: 'fake', missing: [] } })
    expect(health.github_access.permissions.map((p: { key: string }) => p.key)).toContain('repository_hooks')
  })
})
