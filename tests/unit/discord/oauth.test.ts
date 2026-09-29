import { describe, expect, it } from 'vitest'
import { McpToolError } from '../../../src/contracts/index.js'
import { createDiscordOAuthPort } from '../../../src/discord/oauth.js'

interface Seen { url: string; method: string; headers: Record<string, string>; body: string | undefined; signal: AbortSignal | null | undefined }

const harness = (respond: (url: string) => Response) => {
  const seen: Seen[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: init?.body === undefined ? undefined : String(init.body),
      signal: init?.signal,
    })
    return respond(String(url))
  }) as typeof fetch
  return { seen, port: createDiscordOAuthPort({ clientId: 'cid', clientSecret: 'sekret', fetchImpl }) }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

describe('discord oauth port', () => {
  it('exchangeCode posts form-encoded authorization_code grant', async () => {
    const { seen, port } = harness(() => json({ access_token: 'at' }))
    expect(await port.exchangeCode('the-code', 'https://app/cb')).toEqual({ accessToken: 'at' })
    const call = seen[0]!
    expect(call.url).toBe('https://discord.com/api/oauth2/token')
    expect(call.method).toBe('POST')
    expect(call.headers['content-type']).toContain('application/x-www-form-urlencoded')
    const form = new URLSearchParams(call.body)
    expect(Object.fromEntries(form)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cid',
      client_secret: 'sekret',
      code: 'the-code',
      redirect_uri: 'https://app/cb',
    })
  })

  it('exchangeCode failure maps to unauthorized without leaking secrets', async () => {
    const { port } = harness(() => json({ error: 'invalid_grant', error_description: 'sekret the-code' }, 400))
    const err = await port.exchangeCode('the-code', 'https://app/cb').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpToolError)
    expect((err as McpToolError).code).toBe('unauthorized')
    expect(JSON.stringify({ m: (err as Error).message, d: (err as McpToolError).details })).not.toMatch(/sekret|the-code/)
  })

  it('fetchUser sends bearer token', async () => {
    const { seen, port } = harness(() => json({ id: '7', username: 'ann', extra: 1 }))
    expect(await port.fetchUser('at')).toEqual({ id: '7', username: 'ann' })
    expect(seen[0]!.url).toBe('https://discord.com/api/v10/users/@me')
    expect(seen[0]!.headers.authorization).toBe('Bearer at')
  })

  it('fetchUserGuilds returns id and permissions', async () => {
    const { seen, port } = harness(() => json([{ id: '1', name: 'g', permissions: '8' }]))
    expect(await port.fetchUserGuilds('at')).toEqual([{ id: '1', permissions: '8' }])
    expect(seen[0]!.url).toBe('https://discord.com/api/v10/users/@me/guilds?limit=200')
    expect(seen[0]!.headers.authorization).toBe('Bearer at')
  })

  it('fetchUser rejection maps to unauthorized', async () => {
    const { port } = harness(() => json({ message: '401: Unauthorized' }, 401))
    await expect(port.fetchUser('bad')).rejects.toMatchObject({ code: 'unauthorized' })
  })

  it('fetchUserGuilds pages with after until a short page', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({ id: String(1000 + i), permissions: '8' }))
    const { seen, port } = harness((url) => (url.includes('after=') ? json([{ id: '9000', permissions: '32' }]) : json(page1)))
    const guilds = await port.fetchUserGuilds('at')
    expect(guilds).toHaveLength(201)
    expect(guilds.at(-1)).toEqual({ id: '9000', permissions: '32' })
    expect(seen.map((s) => s.url)).toEqual([
      'https://discord.com/api/v10/users/@me/guilds?limit=200',
      'https://discord.com/api/v10/users/@me/guilds?limit=200&after=1199',
    ])
  })

  it('every request carries an abort signal', async () => {
    const { seen, port } = harness((url) => (url.includes('oauth2/token') ? json({ access_token: 'at' }) : json({ id: '1', username: 'a' })))
    await port.exchangeCode('c', 'https://app/cb')
    await port.fetchUser('at')
    expect(seen.every((s) => s.signal instanceof AbortSignal)).toBe(true)
  })

  it('a hung request times out as unauthorized', async () => {
    const fetchImpl = ((_url: string, init?: RequestInit) =>
      new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch
    const port = createDiscordOAuthPort({ clientId: 'c', clientSecret: 's', fetchImpl, timeoutMs: 20 })
    await expect(port.fetchUser('at')).rejects.toMatchObject({ code: 'unauthorized' })
  })
})
