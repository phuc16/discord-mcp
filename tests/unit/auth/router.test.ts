import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createAuthProvider } from '../../../src/auth/provider.js'
import type { AuthRateLimits } from '../../../src/auth/router.js'
import { createAuthRouter } from '../../../src/auth/router.js'
import { openStore } from '../../../src/store/index.js'

describe('auth router', () => {
  let base: string
  let close: () => Promise<void>
  let redirectTarget: string

  const start = async (rateLimits?: AuthRateLimits) => {
    const store = openStore(':memory:')
    const app = express()
    const server = createServer(app)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    const provider = createAuthProvider({
      store,
      discordOAuth: {
        exchangeCode: async () => ({ accessToken: 't' }),
        fetchUser: async () => ({ id: 'u', username: 'n' }),
        fetchUserGuilds: async () => [],
      },
      discord: { listBotGuildIds: async () => [] },
      policy: { guildAllowed: () => true },
      config: { publicBaseUrl: base, discordClientId: 'dcid' },
    })
    app.use(createAuthRouter(provider, { publicBaseUrl: base, rateLimits }))
    redirectTarget = 'http://localhost:9999/cb'
    close = () =>
      new Promise<void>((r) => {
        server.close(() => r())
        server.closeAllConnections()
      })
  }

  beforeEach(() => start())

  afterEach(async () => {
    await close()
  })

  it('serves authorization server metadata with issuer equal to the public base url', async () => {
    const res = await fetch(`${base}/.well-known/oauth-authorization-server`)
    expect(res.status).toBe(200)
    const meta = (await res.json()) as Record<string, unknown>
    expect(meta.issuer).toBe(`${base}/`)
    expect(meta.authorization_endpoint).toBe(`${base}/authorize`)
    expect(meta.token_endpoint).toBe(`${base}/token`)
    expect(meta.registration_endpoint).toBe(`${base}/register`)
    expect(meta.code_challenge_methods_supported).toEqual(['S256'])
  })

  it('serves protected resource metadata at the advertised path', async () => {
    const res = await fetch(`${base}/.well-known/oauth-protected-resource`)
    expect(res.status).toBe(200)
    const meta = (await res.json()) as { authorization_servers: string[] }
    expect(meta.authorization_servers.map((s) => s.replace(/\/$/, ''))).toEqual([base])
  })

  it('callback with a bad state returns 400', async () => {
    const res = await fetch(`${base}/callback?code=abc&state=nope`, { redirect: 'manual' })
    expect(res.status).toBe(400)
    expect(await res.json()).toMatchObject({ error: 'invalid_request' })
  })

  it('callback without code or state returns 400', async () => {
    expect((await fetch(`${base}/callback`, { redirect: 'manual' })).status).toBe(400)
    expect((await fetch(`${base}/callback?code=abc`, { redirect: 'manual' })).status).toBe(400)
  })

  it('dynamic registration then authorize redirects to discord', async () => {
    const reg = await fetch(`${base}/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: [redirectTarget], token_endpoint_auth_method: 'none', client_name: 'x' }),
    })
    expect(reg.status).toBe(201)
    const client = (await reg.json()) as { client_id: string }
    const qs = new URLSearchParams({
      response_type: 'code', client_id: client.client_id, redirect_uri: redirectTarget, code_challenge: 'c'.repeat(43),
      code_challenge_method: 'S256', state: 's1',
    })
    const res = await fetch(`${base}/authorize?${qs}`, { redirect: 'manual' })
    expect(res.status).toBe(302)
    const loc = new URL(res.headers.get('location')!)
    expect(loc.origin).toBe('https://discord.com')
    expect(loc.searchParams.get('redirect_uri')).toBe(`${base}/callback`)
  })

  describe('rate limits', () => {
    const register = () =>
      fetch(`${base}/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ redirect_uris: ['http://localhost:9999/cb'], token_endpoint_auth_method: 'none' }),
      })

    it('limits /register by default', async () => {
      const statuses: number[] = []
      for (let i = 0; i < 25; i++) statuses.push((await register()).status)
      expect(statuses).toContain(429)
    })

    it('rateLimits false disables the limiter', async () => {
      await close()
      await start({ authorize: false, token: false, register: false, revoke: false })
      const statuses: number[] = []
      for (let i = 0; i < 25; i++) statuses.push((await register()).status)
      expect(statuses.every((s) => s === 201)).toBe(true)
    })

    it('rateLimits override tightens a limiter', async () => {
      await close()
      await start({ register: { limit: 2, windowMs: 60_000 } })
      const statuses: number[] = []
      for (let i = 0; i < 3; i++) statuses.push((await register()).status)
      expect(statuses).toEqual([201, 201, 429])
    })
  })
})
