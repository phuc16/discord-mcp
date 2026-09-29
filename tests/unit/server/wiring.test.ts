import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfigSchema } from '../../../src/contracts/index.js'
import type { Config, DiscordOAuthPort } from '../../../src/contracts/index.js'
import { launch } from '../../../src/server/index.js'
import type { RuntimeInput } from '../../../src/server/wiring.js'
import { buildRuntime } from '../../../src/server/wiring.js'
import { openStore } from '../../../src/store/index.js'
import { FakeDiscordPort } from '../../fakes/fake-discord-port.js'
import { FakeGateway } from '../../fakes/fake-gateway.js'

const G = '100000000000000001'
const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const config = (): Config => {
  const c = ConfigSchema.parse({
    guilds: { [G]: { max_tier: 'destructive' } },
    http: { host: '127.0.0.1', port: 8787, service_tokens: [{ name: 'ci', sha256: sha('svc') }] },
  })
  return { ...c, http: { ...c.http, port: 0 } }
}

const oauth: DiscordOAuthPort = {
  exchangeCode: async () => ({ accessToken: 'x' }),
  fetchUser: async () => ({ id: '1', username: 'u' }),
  fetchUserGuilds: async () => [],
}

const input = (): RuntimeInput & { gateway: FakeGateway } => ({
  config: config(),
  env: { PUBLIC_BASE_URL: 'http://127.0.0.1', DISCORD_CLIENT_ID: '1' },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  store: openStore(':memory:'),
  discord: new FakeDiscordPort(),
  gateway: new FakeGateway(),
  discordOAuth: oauth,
})

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '1' } },
}
const headers = { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }

let closer: { close(): Promise<void> } | undefined
afterEach(async () => {
  await closer?.close()
  closer = undefined
})

describe('buildRuntime', () => {
  it('registers all tools minus denied and starts and stops components', async () => {
    const i = input()
    i.config.tools.deny = ['guild_prune']
    const runtime = buildRuntime(i, { http: false })
    expect(runtime.deps.registry.has('guild_prune')).toBe(false)
    expect(runtime.deps.registry.has('guild_get')).toBe(true)
    await runtime.start()
    expect(i.gateway.status()).toBe('ready')
    await runtime.stop()
    expect(i.gateway.status()).toBe('disconnected')
    i.store.close()
  })
  it('prunes expired store rows on a timer and stops on stop', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
    try {
      const i = input()
      const runtime = buildRuntime(i, { http: false })
      await runtime.start()
      i.store.confirmations.create({ tokenHash: 't', inputHash: 'i', principalKey: 'p', tool: 'x', expiresAt: 1 })
      await vi.advanceTimersByTimeAsync(11 * 60_000)
      expect(i.store.confirmations.consume({ tokenHash: 't', inputHash: 'i', principalKey: 'p', tool: 'x', now: 0 })).toBe('invalid')
      await runtime.stop()
      expect(vi.getTimerCount()).toBe(0)
      i.store.close()
    } finally {
      vi.useRealTimers()
    }
  })
  it('requires the oauth port for http', () => {
    const i = input()
    i.discordOAuth = undefined
    expect(() => buildRuntime(i, { http: true })).toThrow(/oauth/)
    i.store.close()
  })
  it('runs tools through the safety pipeline and audits', async () => {
    const i = input()
    const runtime = buildRuntime(i, { http: false })
    const def = runtime.deps.registry.get('guild_list')!
    const principal = { kind: 'stdio' as const, userId: null, userName: 'stdio', guilds: {} }
    await runtime.deps.runTool(def, {}, principal, { correlationId: 'c1' })
    expect(i.store.audit.query({ limit: 5 })[0]).toMatchObject({ tool: 'guild_list', outcome: 'ok', correlationId: 'c1' })
    await expect(runtime.deps.runTool(runtime.deps.registry.get('guild_get')!, { guild_id: '999999999999999999' }, principal, { correlationId: 'c2' })).rejects.toMatchObject({
      code: 'guild_not_allowed',
    })
    i.store.close()
  })
})

describe('launch failure', () => {
  it('closes the store and releases its lock when the gateway fails to start', async () => {
    const i = input()
    vi.spyOn(i.gateway, 'start').mockRejectedValue(new Error('invalid token'))
    await expect(launch(i, { http: true })).rejects.toThrow(/invalid token/)
    expect(() => i.store.audit.query({ limit: 1 })).toThrow()
  })
})

describe('launch (http)', () => {
  it('serves healthz, protects /mcp, accepts a service token and shuts down cleanly', async () => {
    const i = input()
    const handle = await launch(i, { http: true })
    closer = handle
    const base = `http://127.0.0.1:${handle.port}`
    expect(await (await fetch(`${base}/healthz`)).json()).toEqual({ status: 'ok', gateway: 'ready', db: 'ok' })
    const spy = vi.spyOn(i.gateway, 'status').mockReturnValue('disconnected')
    expect((await fetch(`${base}/healthz`)).status).toBe(503)
    spy.mockRestore()
    const denied = await fetch(`${base}/mcp`, { method: 'POST', headers, body: JSON.stringify(initialize) })
    expect(denied.status).toBe(401)
    expect(denied.headers.get('www-authenticate')).toContain('resource_metadata=')
    const ok = await fetch(`${base}/mcp`, { method: 'POST', headers: { ...headers, authorization: 'Bearer svc' }, body: JSON.stringify(initialize) })
    expect(ok.status).toBe(200)
    expect((await fetch(`${base}/.well-known/oauth-authorization-server`)).status).toBe(200)
    await handle.close()
    closer = undefined
    expect(i.gateway.status()).toBe('disconnected')
    await expect(fetch(`${base}/healthz`)).rejects.toThrow()
    expect(() => i.store.audit.query({ limit: 1 })).toThrow()
  })
})
