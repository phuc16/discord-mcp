import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:net'
import { Writable } from 'node:stream'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLogger } from '../../src/cli/logger.js'
import { ConfigSchema } from '../../src/contracts/index.js'
import { createDiscordOAuthPort } from '../../src/discord/index.js'
import { startHttp } from '../../src/server/http.js'
import type { HttpHandle } from '../../src/server/http.js'
import { buildRuntime } from '../../src/server/wiring.js'
import type { Runtime } from '../../src/server/wiring.js'
import { openStore } from '../../src/store/index.js'
import type { Store } from '../../src/store/index.js'
import { FakeDiscordPort } from '../fakes/fake-discord-port.js'
import { FakeGateway } from '../fakes/fake-gateway.js'
import { startMockDiscord } from '../fakes/mock-discord-server.js'
import type { MockDiscord, MockUser } from '../fakes/mock-discord-server.js'

const GUILD_A = '100000000000000001'
const GUILD_B = '100000000000000002'
const GUILD_X = '100000000000000009'
const REDIRECT = 'http://127.0.0.1:9/cb'
const DISCORD_SECRET = 'super-secret-discord-client-secret'
const SERVICE_TOKEN = 'service-token-for-ci-0123456789'

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })

const b64url = (b: Buffer): string => b.toString('base64url')
const pkce = () => {
  const verifier = b64url(randomBytes(48))
  return { verifier, challenge: b64url(createHash('sha256').update(verifier).digest()) }
}

const mockUsers: Record<string, MockUser> = {}
let codeCounter = 0

const PROFILES = {
  alice: { id: '9001', username: 'alice', guilds: [{ id: GUILD_A, permissions: '8' }] },
  manageGuild: { id: '9002', username: 'mallory-mg', guilds: [{ id: GUILD_A, permissions: '32' }] },
  nonadmin: { id: '9003', username: 'bob', guilds: [{ id: GUILD_A, permissions: '2048' }] },
  otherGuild: { id: '9004', username: 'carol', guilds: [{ id: GUILD_X, permissions: '8' }] },
  multi: {
    id: '9005',
    username: 'dave',
    guilds: [
      { id: GUILD_A, permissions: '8' },
      { id: GUILD_B, permissions: '8' },
    ],
  },
  solo: { id: '9006', username: 'erin', guilds: [{ id: GUILD_B, permissions: '8' }] },
  second: { id: '9007', username: 'frank', guilds: [{ id: GUILD_A, permissions: '8' }] },
} satisfies Record<string, MockUser>

const codeFor = (profile: keyof typeof PROFILES): string => {
  codeCounter += 1
  const code = `mock-code-${profile}-${codeCounter}`
  mockUsers[code] = PROFILES[profile]
  return code
}

let sharedClient: Registered | undefined

let base = ''
let mock: MockDiscord
let store: Store
let runtime: Runtime
let http: HttpHandle
let discord: FakeDiscordPort
let gateway: FakeGateway
const logLines: string[] = []
const observed: string[] = []
const secrets = new Set<string>([DISCORD_SECRET])

const record = async (res: Response): Promise<{ status: number; text: string; res: Response }> => {
  const text = await res.text()
  return { status: res.status, text, res }
}

const req = async (path: string, init: RequestInit = {}, opts: { sensitive?: boolean } = {}) => {
  const r = await record(await fetch(`${base}${path}`, { redirect: 'manual', ...init }))
  if (!opts.sensitive) observed.push(r.text, r.res.headers.get('location') ?? '')
  return r
}

const form = (data: Record<string, string>): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(data),
})

interface Registered {
  client_id: string
  client_secret?: string
}

const register = async (opts: { confidential?: boolean } = {}): Promise<Registered> => {
  const r = await req(
    '/register',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        redirect_uris: [REDIRECT],
        token_endpoint_auth_method: opts.confidential ? 'client_secret_post' : 'none',
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        client_name: 'qa-client',
      }),
    },
    { sensitive: true },
  )
  expect(r.status).toBeLessThan(300)
  const body = JSON.parse(r.text) as Registered
  if (body.client_secret) secrets.add(body.client_secret)
  return body
}

const authorizeUrl = (client: Registered, o: { challenge?: string; redirect?: string; state?: string; method?: string } = {}): string => {
  const p = new URLSearchParams({
    response_type: 'code',
    client_id: client.client_id,
    redirect_uri: o.redirect ?? REDIRECT,
    state: o.state ?? 'client-state-1',
    code_challenge_method: o.method ?? 'S256',
  })
  if (o.challenge !== null) p.set('code_challenge', o.challenge ?? 'x'.repeat(43))
  return `/authorize?${p.toString()}`
}

const startAuthorize = async (client: Registered, o: { challenge: string; state?: string }) => {
  const r = await req(authorizeUrl(client, o))
  expect(r.status).toBe(302)
  const location = new URL(r.res.headers.get('location')!)
  return { location, discordState: location.searchParams.get('state')! }
}

const callback = async (code: string, state: string) => req(`/callback?${new URLSearchParams({ code, state }).toString()}`)

interface Tokens {
  access_token: string
  refresh_token: string
  token_type: string
  expires_in: number
}

const tokenExchange = async (client: Registered, code: string, verifier: string, extra: Record<string, string> = {}) => {
  const r = await req(
    '/token',
    form({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      ...(client.client_secret ? { client_secret: client.client_secret } : {}),
      code,
      code_verifier: verifier,
      redirect_uri: REDIRECT,
      ...extra,
    }),
    { sensitive: true },
  )
  if (r.status === 200) {
    const t = JSON.parse(r.text) as Tokens
    secrets.add(t.access_token)
    secrets.add(t.refresh_token)
  }
  return r
}

const defaultClient = async (): Promise<Registered> => (sharedClient ??= await register())

const login = async (mockCode: string, client?: Registered) => {
  const c = client ?? (await defaultClient())
  const { verifier, challenge } = pkce()
  const { discordState } = await startAuthorize(c, { challenge })
  const cb = await callback(mockCode, discordState)
  const back = new URL(cb.res.headers.get('location') ?? 'http://none/')
  return { client: c, verifier, cb, back, code: back.searchParams.get('code'), error: back.searchParams.get('error') }
}

const fullLogin = async (mockCode: string, client?: Registered) => {
  const l = await login(mockCode, client)
  expect(l.code, `login for ${mockCode}`).toBeTruthy()
  const t = await tokenExchange(l.client, l.code!, l.verifier)
  expect(t.status).toBe(200)
  return { ...l, tokens: JSON.parse(t.text) as Tokens }
}

const bearer = (token: string): RequestInit => ({ headers: { authorization: `Bearer ${token}` } })

const mcpClient = async (token: string): Promise<Client> => {
  const client = new Client({ name: 'qa', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: bearer(token) }))
  return client
}

const toolJson = (r: unknown): { isError: boolean; body: Record<string, unknown>; text: string } => {
  const c = r as { isError?: boolean; content: { text: string }[] }
  const text = c.content[0]!.text
  observed.push(text)
  return { isError: c.isError === true, body: JSON.parse(text) as Record<string, unknown>, text }
}

const codeOf = (r: { body: Record<string, unknown> }): string | undefined => (r.body.error as { code?: string } | undefined)?.code

const initialize = async (token: string) =>
  req('/mcp', {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'qa', version: '0' } },
    }),
  })

beforeAll(async () => {
  const port = await freePort()
  base = `http://127.0.0.1:${port}`
  mock = await startMockDiscord({ users: mockUsers })
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      logLines.push(chunk.toString('utf8'))
      cb()
    },
  })
  const logger = createLogger({ level: 'debug', destination: sink })
  store = openStore(':memory:')
  discord = new FakeDiscordPort()
  discord.seedGuild(GUILD_A)
  discord.seedGuild(GUILD_B)
  discord.memberPermissions.set(`${GUILD_A}:9005`, '8')
  discord.memberPermissions.set(`${GUILD_B}:9005`, '8')
  discord.memberPermissions.set(`${GUILD_B}:9006`, '8')
  discord.memberPermissions.set(`${GUILD_A}:9001`, '8')
  gateway = new FakeGateway()
  const rewrite = (url: string): string =>
    url.replace('https://discord.com/api/oauth2/', `${mock.url}/oauth2/`).replace('https://discord.com/api/v10/', `${mock.url}/`)
  const config = ConfigSchema.parse({
    guilds: { [GUILD_A]: { max_tier: 'destructive' }, [GUILD_B]: { max_tier: 'write' } },
    http: { host: '127.0.0.1', port, service_tokens: [{ name: 'ci', sha256: createHash('sha256').update(SERVICE_TOKEN).digest('hex') }] },
  })
  runtime = buildRuntime(
    {
      config,
      env: { PUBLIC_BASE_URL: base, DISCORD_CLIENT_ID: 'discord-client-id', DISCORD_CLIENT_SECRET: DISCORD_SECRET },
      logger,
      store,
      discord,
      gateway,
      discordOAuth: createDiscordOAuthPort({
        clientId: 'discord-client-id',
        clientSecret: DISCORD_SECRET,
        fetchImpl: (input, init) => fetch(rewrite(String(input)), init),
      }),
    },
    { http: true },
  )
  await runtime.start()
  http = await startHttp({
    deps: runtime.deps,
    host: '127.0.0.1',
    port,
    bearer: runtime.http!.bearer,
    authRouter: runtime.http!.router,
    health: () => ({ gateway: gateway.status(), db: 'ok' }),
  })
})

afterAll(async () => {
  await http.close()
  await runtime.stop()
  await mock.close()
  store.close()
})

describe('discovery', () => {
  it('serves protected resource and authorization server metadata', async () => {
    const pr = await req('/.well-known/oauth-protected-resource')
    expect(pr.status).toBe(200)
    expect(JSON.parse(pr.text)).toMatchObject({ resource: expect.stringContaining(base) })
    const as = await req('/.well-known/oauth-authorization-server')
    expect(as.status).toBe(200)
    const meta = JSON.parse(as.text) as Record<string, unknown>
    expect(meta.authorization_endpoint).toBe(`${base}/authorize`)
    expect(meta.token_endpoint).toBe(`${base}/token`)
    expect(meta.code_challenge_methods_supported).toEqual(['S256'])
  })

  it('rejects unauthenticated POST /mcp with WWW-Authenticate resource_metadata', async () => {
    const r = await req('/mcp', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: '{}',
    })
    expect(r.status).toBe(401)
    expect(r.res.headers.get('www-authenticate')).toContain('resource_metadata=')
    expect(r.res.headers.get('www-authenticate')).toContain(`${base}/.well-known/oauth-protected-resource`)
  })

  it('rejects a bogus bearer token', async () => {
    expect((await initialize('not-a-token')).status).toBe(401)
  })

  it('healthz is open', async () => {
    const r = await req('/healthz')
    expect(r.status).toBe(200)
    expect(JSON.parse(r.text)).toMatchObject({ status: 'ok', db: 'ok' })
  })
})

describe('happy path', () => {
  it('runs authorize, callback, token, mcp, refresh with reuse detection and revoke', async () => {
    const client = await register()
    const { verifier, challenge } = pkce()
    const { location, discordState } = await startAuthorize(client, { challenge, state: 'client-state-happy' })
    expect(location.origin + location.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(location.searchParams.get('scope')).toBe('identify guilds')
    expect(location.searchParams.get('client_id')).toBe('discord-client-id')
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('redirect_uri')).toBe(`${base}/callback`)
    expect(discordState.length).toBeGreaterThanOrEqual(32)
    expect(discordState).not.toBe('client-state-happy')

    const cb = await callback(codeFor('alice'), discordState)
    expect(cb.status).toBe(302)
    const back = new URL(cb.res.headers.get('location')!)
    expect(back.origin + back.pathname).toBe(REDIRECT)
    expect(back.searchParams.get('state')).toBe('client-state-happy')
    const code = back.searchParams.get('code')!
    expect(code).toBeTruthy()

    const t = await tokenExchange(client, code, verifier)
    expect(t.status).toBe(200)
    const tokens = JSON.parse(t.text) as Tokens
    expect(tokens.token_type.toLowerCase()).toBe('bearer')
    expect(tokens.expires_in).toBe(3600)

    const mcp = await mcpClient(tokens.access_token)
    const names = (await mcp.listTools()).tools.map((x) => x.name)
    expect(names).toContain('server_whoami')
    const who = toolJson(await mcp.callTool({ name: 'server_whoami', arguments: {} }))
    expect(who.body).toMatchObject({ kind: 'user', user_id: '9001', user_name: 'alice', guild_ids: [GUILD_A] })
    await mcp.close()

    const refreshed = await req(
      '/token',
      form({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token }),
      { sensitive: true },
    )
    expect(refreshed.status).toBe(200)
    const next = JSON.parse(refreshed.text) as Tokens
    secrets.add(next.access_token)
    secrets.add(next.refresh_token)
    expect(next.refresh_token).not.toBe(tokens.refresh_token)
    expect(next.access_token).not.toBe(tokens.access_token)
    expect((await initialize(next.access_token)).status).toBe(200)

    const replay = await req(
      '/token',
      form({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: tokens.refresh_token }),
      { sensitive: true },
    )
    expect(replay.status).toBe(400)
    expect(JSON.parse(replay.text).error).toBe('invalid_grant')
    expect((await initialize(next.access_token)).status).toBe(401)
    expect((await initialize(tokens.access_token)).status).toBe(401)
    const afterReplay = await req(
      '/token',
      form({ grant_type: 'refresh_token', client_id: client.client_id, refresh_token: next.refresh_token }),
      { sensitive: true },
    )
    expect(afterReplay.status).toBe(400)
  })

  it('revoke invalidates the access token', async () => {
    const s = await fullLogin(codeFor('alice'))
    expect((await initialize(s.tokens.access_token)).status).toBe(200)
    const revoke = await req(
      '/revoke',
      form({ client_id: s.client.client_id, token: s.tokens.access_token, token_type_hint: 'access_token' }),
      { sensitive: true },
    )
    expect(revoke.status).toBe(200)
    expect((await initialize(s.tokens.access_token)).status).toBe(401)
    const reuse = await req(
      '/token',
      form({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: s.tokens.refresh_token }),
      { sensitive: true },
    )
    expect(reuse.status).toBe(400)
  })

  it('revoking a refresh token also stops the access token', async () => {
    const s = await fullLogin(codeFor('alice'))
    const revoke = await req(
      '/revoke',
      form({ client_id: s.client.client_id, token: s.tokens.refresh_token, token_type_hint: 'refresh_token' }),
      { sensitive: true },
    )
    expect(revoke.status).toBe(200)
    expect((await initialize(s.tokens.access_token)).status).toBe(401)
  })

  it('registration always yields a public client without a secret', async () => {
    const client = await register({ confidential: true })
    expect(client.client_secret).toBeUndefined()
  })

  it('a refresh token cannot be used by a different client', async () => {
    const s = await fullLogin(codeFor('alice'))
    const other = await register()
    const r = await req(
      '/token',
      form({ grant_type: 'refresh_token', client_id: other.client_id, refresh_token: s.tokens.refresh_token }),
      { sensitive: true },
    )
    expect(r.status).toBe(400)
    expect(JSON.parse(r.text).error).toBe('invalid_grant')
  })

  it('a refresh token is not accepted as an access token', async () => {
    const s = await fullLogin(codeFor('alice'))
    expect((await initialize(s.tokens.refresh_token)).status).toBe(401)
  })

  it('the service token can initialize and is the service principal', async () => {
    const mcp = await mcpClient(SERVICE_TOKEN)
    const who = toolJson(await mcp.callTool({ name: 'server_whoami', arguments: {} }))
    expect(who.body).toMatchObject({ kind: 'service', user_name: 'ci' })
    const read = toolJson(await mcp.callTool({ name: 'guild_get', arguments: { guild_id: GUILD_A } }))
    expect(read.isError).toBe(false)
    const denied = toolJson(await mcp.callTool({ name: 'guild_get', arguments: { guild_id: GUILD_X } }))
    expect(codeOf(denied)).toBe('guild_not_allowed')
    await mcp.close()
  })
})

describe('negative cases', () => {
  it('rejects an unregistered redirect uri at /authorize without redirecting', async () => {
    const client = await register()
    const { challenge } = pkce()
    const r = await req(authorizeUrl(client, { challenge, redirect: 'http://evil.example/cb' }))
    expect(r.status).toBe(400)
    expect(r.res.headers.get('location')).toBeNull()
  })

  it('rejects a missing code_challenge', async () => {
    const client = await register()
    const r = await req(authorizeUrl(client, { challenge: null as unknown as undefined }))
    expect(r.status === 302 ? new URL(r.res.headers.get('location')!).searchParams.get('error') : r.status).not.toBeNull()
    expect(r.status === 302 ? (r.res.headers.get('location') ?? '').startsWith('https://discord.com') : false).toBe(false)
  })

  it('rejects a non-S256 challenge method', async () => {
    const client = await register()
    const r = await req(authorizeUrl(client, { challenge: 'x'.repeat(43), method: 'plain' }))
    expect((r.res.headers.get('location') ?? '').startsWith('https://discord.com')).toBe(false)
  })

  it('rejects a wrong PKCE verifier and a missing verifier', async () => {
    const l = await login(codeFor('alice'))
    expect(l.code).toBeTruthy()
    const wrong = await tokenExchange(l.client, l.code!, pkce().verifier)
    expect(wrong.status).toBe(400)
    expect(JSON.parse(wrong.text).error).toBe('invalid_grant')
    const missing = await req(
      '/token',
      form({ grant_type: 'authorization_code', client_id: l.client.client_id, code: l.code!, redirect_uri: REDIRECT }),
      { sensitive: true },
    )
    expect(missing.status).toBe(400)
    const good = await tokenExchange(l.client, l.code!, l.verifier)
    expect(good.status).toBe(200)
  })

  it('rejects a replayed authorization code', async () => {
    const l = await login(codeFor('alice'))
    const first = await tokenExchange(l.client, l.code!, l.verifier)
    expect(first.status).toBe(200)
    const again = await tokenExchange(l.client, l.code!, l.verifier)
    expect(again.status).toBe(400)
    expect(JSON.parse(again.text).error).toBe('invalid_grant')
  })

  it('rejects a mismatched redirect uri at /token', async () => {
    const l = await login(codeFor('alice'))
    const r = await tokenExchange(l.client, l.code!, l.verifier, { redirect_uri: 'http://evil.example/cb' })
    expect(r.status).toBe(400)
  })

  it('rejects an authorization code presented by another client', async () => {
    const l = await login(codeFor('second'))
    const other = await register()
    const r = await tokenExchange(other, l.code!, l.verifier)
    expect(r.status).toBe(400)
  })

  it('rejects a replayed and a forged state at /callback', async () => {
    const client = await register()
    const { challenge } = pkce()
    const { discordState } = await startAuthorize(client, { challenge })
    const first = await callback(codeFor('manageGuild'), discordState)
    expect(first.status).toBe(302)
    const replay = await callback(codeFor('manageGuild'), discordState)
    expect(replay.status).toBe(400)
    expect(replay.res.headers.get('location')).toBeNull()
    const forged = await callback(codeFor('alice'), randomBytes(32).toString('base64url'))
    expect(forged.status).toBe(400)
    expect(forged.res.headers.get('location')).toBeNull()
    expect((await req('/callback')).status).toBe(400)
  })

  it('a user without manage permissions gets access_denied at the client', async () => {
    const l = await login(codeFor('nonadmin'))
    expect(l.error).toBe('access_denied')
    expect(l.code).toBeNull()
    expect(l.back.searchParams.get('state')).toBe('client-state-1')
    expect(l.back.origin + l.back.pathname).toBe(REDIRECT)
  })

  it('an unknown discord code yields no authorization code', async () => {
    const l = await login('code-does-not-exist')
    expect(l.code).toBeNull()
    expect(l.error).toBeTruthy()
  })

  it('an admin of a non-allowlisted guild gets access_denied', async () => {
    const l = await login(codeFor('otherGuild'))
    expect(l.error).toBe('access_denied')
    expect(l.code).toBeNull()
  })

  it('a MANAGE_GUILD-only user can log in but is capped to write on destructive tools', async () => {
    const s = await fullLogin(codeFor('manageGuild'))
    const mcp = await mcpClient(s.tokens.access_token)
    const ch = await discord.createChannel(GUILD_A, { name: 'x', type: 0 })
    const del = toolJson(await mcp.callTool({ name: 'channels_delete', arguments: { guild_id: GUILD_A, channel_id: ch.id } }))
    expect(codeOf(del)).toBe('tier_exceeded')
    expect(discord.channels.has(ch.id)).toBe(true)
    await mcp.close()
  })

  it('an admin of guild A only cannot call tools on guild B', async () => {
    const s = await fullLogin(codeFor('second'))
    const mcp = await mcpClient(s.tokens.access_token)
    const ok = toolJson(await mcp.callTool({ name: 'guild_get', arguments: { guild_id: GUILD_A } }))
    expect(ok.isError).toBe(false)
    const denied = toolJson(await mcp.callTool({ name: 'guild_get', arguments: { guild_id: GUILD_B } }))
    expect(codeOf(denied)).toBe('guild_not_allowed')
    const write = toolJson(await mcp.callTool({ name: 'channels_create', arguments: { guild_id: GUILD_B, name: 'no', type: 0 } }))
    expect(codeOf(write)).toBe('guild_not_allowed')
    expect([...discord.channels.values()].some((c) => c.name === 'no')).toBe(false)
    await mcp.close()
  })

  it('an mcp session belongs to its principal', async () => {
    const a = await fullLogin(codeFor('alice'))
    const init = await initialize(a.tokens.access_token)
    expect(init.status).toBe(200)
    const sid = init.res.headers.get('mcp-session-id')!
    expect(sid).toBeTruthy()
    const b = await fullLogin(codeFor('solo'))
    const hijack = await req('/mcp', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${b.tokens.access_token}`,
        'mcp-session-id': sid,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    })
    expect(hijack.status).toBe(404)
  })
})

describe('permission changes', () => {
  it('a role_update demotion removes the guild from the next call while keeping other guilds', async () => {
    const s = await fullLogin(codeFor('multi'))
    const mcp = await mcpClient(s.tokens.access_token)
    expect(toolJson(await mcp.callTool({ name: 'guild_get', arguments: { guild_id: GUILD_A } })).isError).toBe(false)
    expect(toolJson(await mcp.callTool({ name: 'server_whoami', arguments: {} })).body.guild_ids).toEqual([GUILD_A, GUILD_B])

    discord.memberPermissions.set(`${GUILD_A}:9005`, '0')
    gateway.emit({ guildId: GUILD_A, type: 'role_update', at: new Date().toISOString(), data: { role_id: '1' } })
    await expect
      .poll(async () => codeOf(toolJson(await mcp.callTool({ name: 'guild_get', arguments: { guild_id: GUILD_A } }))), { timeout: 3000 })
      .toBe('guild_not_allowed')
    expect(toolJson(await mcp.callTool({ name: 'guild_get', arguments: { guild_id: GUILD_B } })).isError).toBe(false)
    expect(toolJson(await mcp.callTool({ name: 'server_whoami', arguments: {} })).body.guild_ids).toEqual([GUILD_B])
    await mcp.close()
  })

  it('a demotion that removes every guild revokes the session', async () => {
    const s = await fullLogin(codeFor('solo'))
    expect((await initialize(s.tokens.access_token)).status).toBe(200)
    discord.memberPermissions.set(`${GUILD_B}:9006`, '0')
    gateway.emit({ guildId: GUILD_B, type: 'role_update', at: new Date().toISOString(), data: { role_id: '1' } })
    await expect.poll(async () => (await initialize(s.tokens.access_token)).status, { timeout: 3000 }).toBe(401)
    const refresh = await req(
      '/token',
      form({ grant_type: 'refresh_token', client_id: s.client.client_id, refresh_token: s.tokens.refresh_token }),
      { sensitive: true },
    )
    expect(refresh.status).toBe(400)
  })

  it('a member_remove event revokes a user who left the guild', async () => {
    const s = await fullLogin(codeFor('second'))
    discord.memberPermissions.delete(`${GUILD_A}:9007`)
    gateway.emit({ guildId: GUILD_A, type: 'member_remove', at: new Date().toISOString(), data: { user_id: '9007' } })
    await expect.poll(async () => (await initialize(s.tokens.access_token)).status, { timeout: 3000 }).toBe(401)
  })
})

describe('secret hygiene', () => {
  it('no response body, location header or log line contains an issued token or secret', () => {
    expect(secrets.size).toBeGreaterThan(10)
    const haystacks = [...observed, ...logLines]
    expect(logLines.length).toBeGreaterThan(0)
    for (const secret of secrets) {
      for (const h of haystacks) expect(h.includes(secret), `leaked ${secret.slice(0, 8)}…`).toBe(false)
    }
    const all = haystacks.join('\n')
    expect(all).not.toContain('Bearer ')
    expect(all).not.toContain(SERVICE_TOKEN)
  })

  it('access log lines use the structured field names', () => {
    const lines = logLines
      .map((l) => {
        try {
          return JSON.parse(l) as Record<string, unknown>
        } catch {
          return null
        }
      })
      .filter((l): l is Record<string, unknown> => l !== null && l.msg === 'http request')
    expect(lines.length).toBeGreaterThan(5)
    for (const l of lines) {
      for (const f of ['request_id', 'method', 'path', 'status', 'ip', 'latency']) expect(l, f).toHaveProperty(f)
    }
    expect(lines.some((l) => l.user_name === 'alice')).toBe(true)
    expect(lines.some((l) => l.path === '/callback')).toBe(true)
    for (const l of lines) expect(JSON.stringify(l)).not.toMatch(/code=|state=/)
  })
})
