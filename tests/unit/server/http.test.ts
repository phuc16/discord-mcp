import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DiscordPort, Principal, Services } from '../../../src/contracts/index.js'
import { startHttp } from '../../../src/server/http.js'
import type { HttpHandle } from '../../../src/server/http.js'
import type { ServerDeps } from '../../../src/server/mcp.js'
import { buildToolRegistry } from '../../../src/server/registry.js'
import { fakeTool } from './helpers.js'

const principal: Principal = { kind: 'service', userId: null, userName: 'ci', guilds: {} }
const META = 'https://mcp.example/.well-known/oauth-protected-resource'

const bearer: express.RequestHandler = (req, res, next) => {
  if (req.headers.authorization === 'Bearer good') {
    ;(req as unknown as { principal: Principal }).principal = principal
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

const start = async () => {
  const authRouter = express.Router()
  authRouter.get('/.well-known/oauth-protected-resource', (_req, res) => void res.json({ resource: 'x' }))
  handle = await startHttp({ deps: deps(), host: '127.0.0.1', port: 0, bearer, authRouter, health: () => ({ gateway: 'ready', db: 'ok' }) })
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
  it('accepts initialize and tools/list with a valid bearer', async () => {
    const base = await start()
    const auth = { ...headers, authorization: 'Bearer good' }
    const init = await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify(initialize) })
    expect(init.status).toBe(200)
    expect(await init.text()).toContain('discord-mcp')
    const list = await fetch(`${base}/mcp`, { method: 'POST', headers: auth, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }) })
    expect(await list.text()).toContain('t_read')
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
