import { afterEach, describe, expect, it } from 'vitest'
import { ConfigSchema } from '../../src/contracts/index.js'
import type { Logger } from '../../src/contracts/index.js'
import { startHttp } from '../../src/server/http.js'
import { buildRuntime } from '../../src/server/wiring.js'
import { openStore } from '../../src/store/index.js'
import { FakeDiscordPort } from '../fakes/fake-discord-port.js'
import { FakeGateway } from '../fakes/fake-gateway.js'
import { GUILD_A, freePort, initializeBody, registerBody, rpc, sha256, startStack } from './stack.js'
import type { Stack } from './stack.js'

const TOKEN_A = 'service-token-a-0123456789abcdef'
const TOKEN_B = 'service-token-b-0123456789abcdef'
const tokens = [
  { name: 'a', sha256: sha256(TOKEN_A) },
  { name: 'b', sha256: sha256(TOKEN_B) },
]

let stack: Stack | undefined
afterEach(async () => {
  await stack?.close()
  stack = undefined
})

const start = async (http: Record<string, unknown> = {}, config: Record<string, unknown> = {}) => {
  stack = await startStack({ http: { service_tokens: tokens, ...http }, config })
  return stack
}

describe('rate limits key on the socket address, not on forwarded headers', () => {
  const burst = async (s: Stack, headers: (i: number) => Record<string, string>) => {
    const statuses: number[] = []
    for (let i = 0; i < 40; i++) {
      const r = await fetch(`${s.base}/register`, { ...registerBody(i), headers: { 'content-type': 'application/json', ...headers(i) } })
      statuses.push(r.status)
      await r.text()
    }
    return statuses
  }

  it('default 429 on a burst of registrations', async () => {
    const s = await start()
    const statuses = await burst(s, () => ({}))
    expect(statuses[0]).toBeLessThan(300)
    expect(statuses).toContain(429)
  })

  it('a spoofed X-Forwarded-For does not bypass the limit when trust_proxy is unset', async () => {
    const s = await start()
    const statuses = await burst(s, (i) => ({ 'x-forwarded-for': `203.0.113.${i + 1}` }))
    expect(statuses).toContain(429)
  })

  it('a spoofed X-Real-IP or Forwarded header does not bypass it either', async () => {
    const s = await start()
    const statuses = await burst(s, (i) => ({ 'x-real-ip': `203.0.113.${i + 1}`, forwarded: `for=203.0.113.${i + 1}` }))
    expect(statuses).toContain(429)
  })

  it('with trust_proxy=1 the proxy supplied address is honoured (config is wired through)', async () => {
    const s = await start({ trust_proxy: 1 })
    const statuses = await burst(s, (i) => ({ 'x-forwarded-for': `203.0.113.${i + 1}` }))
    expect(statuses).not.toContain(429)
  })

  it('the access log records the socket address, not the spoofed header', async () => {
    const s = await start()
    await fetch(`${s.base}/healthz`, { headers: { 'x-forwarded-for': '203.0.113.77' } })
    const line = s.logs.find((l) => l.msg === 'http request' && l.obj.path === '/healthz')
    expect(line?.obj.ip).not.toContain('203.0.113.77')
  })
})

describe('http error surface', () => {
  it('malformed JSON returns generic JSON without stack, paths or framework names', async () => {
    const s = await start()
    const r = await fetch(`${s.base}/mcp`, rpc(TOKEN_A, '{"jsonrpc": nope'))
    const text = await r.text()
    expect(r.status).toBe(400)
    expect(r.headers.get('content-type')).toContain('application/json')
    expect(() => JSON.parse(text)).not.toThrow()
    expect(text).not.toMatch(/SyntaxError|Unexpected token|at .*\(|node_modules|\/Users\/|\.ts:|\.js:|body-parser|express/i)
    expect(Object.keys(JSON.parse(text) as object).sort()).toEqual(['error'])
  })

  it('an oversized body returns a generic 413', async () => {
    const s = await start()
    const r = await fetch(`${s.base}/mcp`, rpc(TOKEN_A, JSON.stringify({ pad: 'x'.repeat(5 * 1024 * 1024) })))
    const text = await r.text()
    expect(r.status).toBe(413)
    expect(text).not.toMatch(/node_modules|\/Users\/|at .*\(|PayloadTooLarge/i)
  })

  it.each(['/healthz', '/mcp', '/does-not-exist', '/.well-known/oauth-protected-resource'])('%s carries no x-powered-by header', async (path) => {
    const s = await start()
    const r = await fetch(`${s.base}${path}`)
    await r.text()
    expect(r.headers.get('x-powered-by')).toBeNull()
  })

  it('an unknown route is not an HTML stack page', async () => {
    const s = await start()
    const r = await fetch(`${s.base}/nope`)
    const text = await r.text()
    expect(text).not.toMatch(/node_modules|\/Users\/|at .*\(/)
  })
})

describe('mcp sessions', () => {
  const init = (s: Stack, token: string, extra: Record<string, string> = {}) => fetch(`${s.base}/mcp`, rpc(token, initializeBody, extra))

  it('failed initializes do not leak sessions or resources', async () => {
    const s = await start({ max_sessions_per_principal: 2 })
    for (let i = 0; i < 12; i++) {
      const bad = await fetch(`${s.base}/mcp`, { ...rpc(TOKEN_A, initializeBody), headers: { authorization: `Bearer ${TOKEN_A}`, 'content-type': 'application/json' } })
      await bad.text()
      expect(bad.status).toBeGreaterThanOrEqual(400)
    }
    const first = await init(s, TOKEN_A)
    const second = await init(s, TOKEN_A)
    expect([first.status, second.status]).toEqual([200, 200])
    await first.text()
    await second.text()
  })

  it('a principal cannot exceed max_sessions_per_principal, other principals are unaffected', async () => {
    const s = await start({ max_sessions_per_principal: 2 })
    const a = [await init(s, TOKEN_A), await init(s, TOKEN_A)]
    expect(a.map((r) => r.status)).toEqual([200, 200])
    const over = await init(s, TOKEN_A)
    expect(over.status).toBe(503)
    await over.text()
    const b = await init(s, TOKEN_B)
    expect(b.status).toBe(200)
    const sid = a[0]!.headers.get('mcp-session-id')!
    const closed = await fetch(`${s.base}/mcp`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN_A}`, 'mcp-session-id': sid } })
    await closed.text()
    const again = await init(s, TOKEN_A)
    expect(again.status).toBe(200)
  })

  it('a session id belongs to its principal', async () => {
    const s = await start()
    const a = await init(s, TOKEN_A)
    const sid = a.headers.get('mcp-session-id')!
    const stolen = await fetch(`${s.base}/mcp`, rpc(TOKEN_B, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, { 'mcp-session-id': sid }))
    await stolen.text()
    expect(stolen.status).toBe(404)
  })
})

describe('healthz', () => {
  it('is 200 when the gateway is ready and the database answers', async () => {
    const s = await start()
    const r = await fetch(`${s.base}/healthz`)
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ status: 'ok', gateway: 'ready', db: 'ok' })
  })

  it('is 503 when the gateway is down and recovers', async () => {
    const s = await start()
    s.gateway.setStatus('disconnected')
    const down = await fetch(`${s.base}/healthz`)
    expect(down.status).toBe(503)
    expect(await down.json()).toMatchObject({ status: 'degraded', gateway: 'disconnected' })
    s.gateway.setStatus('ready')
    expect((await fetch(`${s.base}/healthz`)).status).toBe(200)
  })

  it('is 503 while the gateway is still connecting', async () => {
    const s = await start()
    s.gateway.setStatus('connecting')
    expect((await fetch(`${s.base}/healthz`)).status).toBe(503)
  })
})

describe('client registration policy', () => {
  it('max_clients caps dynamic registration', async () => {
    const s = await start({ max_clients: 3 })
    const statuses: number[] = []
    for (let i = 0; i < 6; i++) {
      const r = await fetch(`${s.base}/register`, registerBody(i))
      statuses.push(r.status)
      await r.text()
    }
    expect(statuses.slice(0, 3).every((c) => c < 300)).toBe(true)
    expect(statuses.slice(3).every((c) => c >= 400)).toBe(true)
  })

  it('allowed_redirect_uris restricts registration to the configured list', async () => {
    const s = await start({ allowed_redirect_uris: ['https://allowed.example/cb'] })
    const ok = await fetch(`${s.base}/register`, registerBody(1, 'https://allowed.example/cb'))
    expect(ok.status).toBeLessThan(300)
    await ok.text()
    for (const uri of ['https://other.example/cb', 'https://allowed.example/other', 'http://127.0.0.1:9/cb']) {
      const r = await fetch(`${s.base}/register`, registerBody(2, uri))
      await r.text()
      expect(r.status, uri).toBeGreaterThanOrEqual(400)
    }
  })
})

describe('event feed subscriptions follow session lifetime', () => {
  it('failed initializes leave zero subscribers; a closed session releases its subscription', async () => {
    const port = await freePort()
    const config = ConfigSchema.parse({
      guilds: { [GUILD_A]: { max_tier: 'destructive' } },
      http: { host: '127.0.0.1', port, service_tokens: tokens },
    })
    const store = openStore(':memory:')
    const discord = new FakeDiscordPort()
    discord.seedGuild(GUILD_A)
    const gateway = new FakeGateway()
    const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }
    const runtime = buildRuntime(
      {
        config,
        env: { PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 's' },
        logger: silent,
        store,
        discord,
        gateway,
        discordOAuth: { exchangeCode: async () => ({ accessToken: 'x' }), fetchUser: async () => ({ id: '1', username: 'u' }), fetchUserGuilds: async () => [] },
      },
      { http: true },
    )
    let active = 0
    const feed = runtime.deps.eventFeed!
    const real = feed.subscribe
    feed.subscribe = (cb) => {
      active += 1
      const off = real(cb)
      let released = false
      return () => {
        if (!released) {
          released = true
          active -= 1
        }
        off()
      }
    }
    await runtime.start()
    const http = await startHttp({
      deps: runtime.deps,
      host: '127.0.0.1',
      port,
      bearer: runtime.http!.bearer,
      authRouter: runtime.http!.router,
      health: () => ({ gateway: gateway.status(), db: 'ok' }),
    })
    const base = `http://127.0.0.1:${port}`
    try {
      for (let i = 0; i < 20; i++) {
        const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { authorization: `Bearer ${TOKEN_A}`, 'content-type': 'application/json' }, body: JSON.stringify(initializeBody) })
        await r.text()
        expect(r.status).toBeGreaterThanOrEqual(400)
      }
      expect(active).toBe(0)
      const ok = await fetch(`${base}/mcp`, rpc(TOKEN_A, initializeBody))
      await ok.text()
      expect(ok.status).toBe(200)
      expect(active).toBe(1)
      const del = await fetch(`${base}/mcp`, { method: 'DELETE', headers: { authorization: `Bearer ${TOKEN_A}`, 'mcp-session-id': ok.headers.get('mcp-session-id')! } })
      await del.text()
      await expect.poll(() => active, { timeout: 2000 }).toBe(0)
    } finally {
      await http.close()
      await runtime.stop()
      store.close()
    }
  })
})
