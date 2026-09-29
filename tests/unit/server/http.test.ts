import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscordPort, NormalizedEvent, Principal, Services } from '../../../src/contracts/index.js'
import { startHttp } from '../../../src/server/http.js'
import type { HttpHandle } from '../../../src/server/http.js'
import type { ServerDeps } from '../../../src/server/mcp.js'
import { buildToolRegistry } from '../../../src/server/registry.js'
import { fakeTool } from './helpers.js'

const G = '123456789012345678'
const principal: Principal = { kind: 'service', userId: null, userName: 'ci', guilds: {} }
const otherPrincipal: Principal = { kind: 'service', userId: null, userName: 'other', guilds: {} }
const META = 'https://mcp.example/.well-known/oauth-protected-resource'

const bearer: express.RequestHandler = (req, res, next) => {
  const who = req.headers.authorization === 'Bearer good' ? principal : req.headers.authorization === 'Bearer other' ? otherPrincipal : undefined
  if (who) {
    ;(req as unknown as { principal: Principal }).principal = who
    next()
    return
  }
  res.status(401).set('WWW-Authenticate', `Bearer resource_metadata="${META}"`).json({ error: 'unauthorized' })
}

const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const deps = (): ServerDeps => ({
  registry: buildToolRegistry([fakeTool('t_read', 'read')], []),
  discord: {} as DiscordPort,
  services: {} as Services,
  logger,
  runTool: async () => ({ data: 1 }),
})

let handle: HttpHandle | undefined
afterEach(async () => {
  await handle?.close()
  handle = undefined
  logger.info.mockClear()
})

const start = async (extra: Partial<Parameters<typeof startHttp>[0]> = {}) => {
  const authRouter = express.Router()
  authRouter.get('/.well-known/oauth-protected-resource', (_req, res) => void res.json({ resource: 'x' }))
  handle = await startHttp({ deps: deps(), host: '127.0.0.1', port: 0, bearer, authRouter, health: () => ({ gateway: 'ready', db: 'ok' }), ...extra })
  return `http://127.0.0.1:${handle.port}`
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
}
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

describe('startHttp', () => {
  it('serves healthz without auth', async () => {
    const base = await start()
    const r = await fetch(`${base}/healthz`)
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ status: 'ok', gateway: 'ready', db: 'ok' })
  })
  it('mounts the auth router at root', async () => {
    const base = await start()
    expect((await fetch(`${base}/.well-known/oauth-protected-resource`)).status).toBe(200)
  })
  it('rejects unauthenticated mcp requests with resource metadata', async () => {
    const base = await start()
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(initialize) })
    expect(r.status).toBe(401)
    expect(r.headers.get('www-authenticate')).toContain(`resource_metadata="${META}"`)
  })
  it('accepts initialize and tools/list on a session', async () => {
    const base = await start()
    const auth = { ...headers, authorization: 'Bearer good' }
    const init = await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify(initialize) })
    expect(init.status).toBe(200)
    expect(await init.text()).toContain('discord-mcp')
    const sid = init.headers.get('mcp-session-id')!
    expect(sid).toBeTruthy()
    const list = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { ...auth, 'mcp-session-id': sid },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })
    expect(await list.text()).toContain('t_read')
  })
  it('rejects a request without session id unless it initializes', async () => {
    const base = await start()
    const r = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { ...headers, authorization: 'Bearer good' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    })
    expect(r.status).toBe(400)
  })
  it('hides a session from a different principal', async () => {
    const base = await start()
    const init = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, authorization: 'Bearer good' }, body: JSON.stringify(initialize) })
    const sid = init.headers.get('mcp-session-id')!
    const call = (method: string, token: string) =>
      fetch(`${base}/mcp`, {
        method,
        headers: { ...headers, authorization: `Bearer ${token}`, 'mcp-session-id': sid },
        body: method === 'POST' ? JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} }) : undefined,
      })
    expect((await call('POST', 'other')).status).toBe(404)
    expect((await call('DELETE', 'other')).status).toBe(404)
    expect((await call('POST', 'good')).status).toBe(200)
  })
  it('DELETE closes the session', async () => {
    const base = await start()
    const auth = { ...headers, authorization: 'Bearer good' }
    const init = await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify(initialize) })
    const sid = init.headers.get('mcp-session-id')!
    expect((await fetch(`${base}/mcp`, { method: 'DELETE', headers: { ...auth, 'mcp-session-id': sid } })).status).toBe(200)
    const after = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...auth, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }) })
    expect(after.status).toBe(404)
  })
  it('caps sessions', async () => {
    const base = await start({ maxSessions: 1 })
    const auth = { ...headers, authorization: 'Bearer good' }
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify(initialize) })).status).toBe(200)
    expect((await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify(initialize) })).status).toBe(503)
  })
  it('expires idle sessions', async () => {
    let t = 0
    const base = await start({ idleTtlMs: 1000, sweepIntervalMs: 10, now: () => t })
    const auth = { ...headers, authorization: 'Bearer good' }
    const init = await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify(initialize) })
    const sid = init.headers.get('mcp-session-id')!
    t = 5000
    await new Promise((r) => setTimeout(r, 60))
    const after = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...auth, 'mcp-session-id': sid }, body: JSON.stringify({ jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} }) })
    expect(after.status).toBe(404)
  })
  it('delivers resources/updated over the session stream', async () => {
    const listeners = new Set<(e: NormalizedEvent) => void>()
    const d = deps()
    d.eventFeed = { subscribe: (cb) => (listeners.add(cb), () => listeners.delete(cb)) }
    d.services = { policy: { effective: () => ({ guilds: { [G]: { maxTier: 'read', effectiveTier: 'read' } }, deniedTools: [] }) } } as unknown as Services
    handle = await startHttp({ deps: d, host: '127.0.0.1', port: 0, bearer, health: () => ({ gateway: 'ready', db: 'ok' }) })
    const client = new Client({ name: 't', version: '1' })
    const updated: string[] = []
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (n) => void updated.push(n.params.uri))
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${handle.port}/mcp`), { requestInit: { headers: { authorization: 'Bearer good' } } }))
    await client.subscribeResource({ uri: `discord://guild/${G}/events` })
    for (const cb of listeners) cb({ id: 1, guildId: G, type: 'message_create', at: 't', data: {} })
    await new Promise((r) => setTimeout(r, 100))
    expect(updated).toEqual([`discord://guild/${G}/events`])
    await client.close()
  })
  it('logs one access line per request with structured fields', async () => {
    const base = await start()
    await fetch(`${base}/healthz`)
    await new Promise((r) => setTimeout(r, 20))
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({ request_id: expect.any(String), method: 'GET', path: '/healthz', status: 200, ip: expect.any(String), latency: expect.any(Number) }),
      'http request',
    )
  })
})
