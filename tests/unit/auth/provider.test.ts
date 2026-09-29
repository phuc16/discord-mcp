import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import { McpToolError } from '../../../src/contracts/index.js'
import type { DiscordOAuthPort } from '../../../src/contracts/index.js'
import { createClientsStore } from '../../../src/auth/clients-store.js'
import { createAuthProvider } from '../../../src/auth/provider.js'
import { hashSecret } from '../../../src/auth/tokens.js'
import { PERM } from '../../../src/safety/index.js'
import { openStore } from '../../../src/store/index.js'
import type { Store } from '../../../src/store/index.js'

const BASE = 'https://mcp.example.com'
const REDIRECT = 'http://localhost:9999/cb'
const G1 = '111111111111111111'
const G2 = '222222222222222222'
const G3 = '333333333333333333'
const VERIFIER = 'v'.repeat(64)
const CHALLENGE = createHash('sha256').update(VERIFIER).digest('base64url')

const perms = (...bits: bigint[]): string => bits.reduce((a, b) => a | b, 0n).toString()

interface FakeUser { id: string; username: string; guilds: { id: string; permissions: string }[] }

describe('auth provider', () => {
  let store: Store
  let clock: number
  let users: Record<string, FakeUser>
  let botGuilds: string[]
  let allowed: Set<string>
  let discordOAuth: DiscordOAuthPort
  let provider: ReturnType<typeof createAuthProvider>
  let client: OAuthClientInformationFull
  let exchangeSpy: ReturnType<typeof vi.fn>
  let beforeIssue: ((s: import('../../../src/store/index.js').Session) => Promise<import('../../../src/store/index.js').Session>) | undefined

  const build = () => {
    provider = createAuthProvider({
      store,
      discordOAuth,
      discord: { listBotGuildIds: async () => botGuilds },
      policy: { guildAllowed: (g) => allowed.has(g) },
      config: { publicBaseUrl: BASE, discordClientId: 'dcid' },
      now: () => clock,
      beforeIssue: beforeIssue ? (s) => beforeIssue!(s) : undefined,
    })
  }

  beforeEach(async () => {
    store = openStore(':memory:')
    clock = 1_000_000
    users = {
      admin: { id: 'u1', username: 'alice', guilds: [{ id: G1, permissions: perms(PERM.ADMINISTRATOR) }, { id: G2, permissions: perms(PERM.MANAGE_GUILD) }, { id: G3, permissions: perms(PERM.ADMINISTRATOR) }] },
      plain: { id: 'u2', username: 'bob', guilds: [{ id: G1, permissions: perms(PERM.MANAGE_MESSAGES) }] },
    }
    botGuilds = [G1, G2]
    allowed = new Set([G1, G2, G3])
    exchangeSpy = vi.fn(async (code: string) => {
      if (!users[code]) throw new McpToolError('unauthorized', 'discord authorization failed')
      return { accessToken: `at-${code}` }
    })
    discordOAuth = {
      exchangeCode: exchangeSpy as never,
      fetchUser: async (t) => {
        const u = users[t.replace('at-', '')]!
        return { id: u.id, username: u.username }
      },
      fetchUserGuilds: async (t) => users[t.replace('at-', '')]!.guilds,
    }
    beforeIssue = undefined
    build()
    const reg = await createClientsStore(store).registerClient!({ redirect_uris: [REDIRECT], client_name: 'c' } as never)
    client = reg
  })

  interface MockRes {
    headers: Record<string, string | string[]>
    body: string
    req: { method: string; headers: Record<string, string>; body?: Record<string, string> }
    redirect: ReturnType<typeof vi.fn>
    setHeader: (k: string, v: string) => MockRes
    appendHeader: (k: string, v: string) => MockRes
    status: () => MockRes
    type: () => MockRes
    send: (b: string) => MockRes
  }
  const mockRes = (req: MockRes['req']): MockRes => {
    const res: MockRes = {
      headers: {},
      body: '',
      req,
      redirect: vi.fn(),
      setHeader: (k, v) => ((res.headers[k] = v), res),
      appendHeader: (k, v) => {
        const cur = res.headers[k]
        res.headers[k] = cur === undefined ? v : [...(Array.isArray(cur) ? cur : [cur]), v]
        return res
      },
      status: () => res,
      type: () => res,
      send: (b) => ((res.body = b), res),
    }
    return res
  }
  const cookieValue = (res: MockRes, name: string): string | undefined => {
    const raw = res.headers['Set-Cookie']
    const list = Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]
    return list.map((c) => new RegExp(`^${name}=([^;]*)`).exec(c)?.[1]).find((v) => v !== undefined)
  }

  const authParams = (over: { redirectUri?: string; codeChallenge?: string; state?: string } = {}) =>
    ({ redirectUri: over.redirectUri ?? REDIRECT, codeChallenge: over.codeChallenge ?? CHALLENGE, state: over.state ?? 'client-state' }) as never

  const consent = async (params = authParams()) => {
    const get = mockRes({ method: 'GET', headers: {} })
    await provider.authorize(client, params, get as never)
    return { get, csrf: cookieValue(get, 'mcp_consent')! }
  }

  const approve = async (params = authParams(), decision = 'approve') => {
    const { csrf } = await consent(params)
    const post = mockRes({ method: 'POST', headers: { cookie: `mcp_consent=${csrf}` }, body: { consent: decision, csrf } })
    await provider.authorize(client, params, post as never)
    return post
  }

  let browserState: string | undefined
  const startAuth = async (over: { redirectUri?: string; codeChallenge?: string; state?: string } = {}) => {
    const post = await approve(authParams(over))
    browserState = cookieValue(post, 'mcp_oauth_state')
    return new URL(post.redirect.mock.calls[0]![0] as string)
  }

  const callback = (code: string, state: string, binding: string | undefined = state) =>
    provider.handleDiscordCallback({ code, state, browserState: binding })

  const login = async (discordCode = 'admin') => {
    const url = await startAuth()
    const { redirectTo } = await callback(discordCode, url.searchParams.get('state')!)
    return new URL(redirectTo)
  }

  const tokensFor = async (discordCode = 'admin') => {
    const cb = await login(discordCode)
    const code = cb.searchParams.get('code')!
    return provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)
  }

  describe('consent', () => {
    it('GET renders a consent page with client name and exact redirect uri, no discord redirect', async () => {
      const { get, csrf } = await consent()
      expect(get.redirect).not.toHaveBeenCalled()
      expect(get.body).toContain(REDIRECT)
      expect(get.body).toContain('name="csrf"')
      expect(get.headers['Content-Security-Policy']).toMatch(/frame-ancestors 'none'/)
      expect(get.headers['X-Frame-Options']).toBe('DENY')
      expect(get.headers['Cache-Control']).toBe('no-store')
      const cookie = String((get.headers['Set-Cookie'] as string))
      expect(cookie).toMatch(/HttpOnly/)
      expect(cookie).toMatch(/SameSite=Lax/)
      expect(csrf).toMatch(/^[A-Za-z0-9_-]{43}$/)
    })

    it('escapes the client name and redirect uri', async () => {
      const evil = await createClientsStore(store).registerClient!({ redirect_uris: ['https://ok.example/cb?a="><script>alert(1)</script>'], client_name: '<img src=x onerror=alert(1)>' } as never)
      const get = mockRes({ method: 'GET', headers: {} })
      await provider.authorize(evil, { redirectUri: 'https://ok.example/cb?a="><script>alert(1)</script>', codeChallenge: CHALLENGE } as never, get as never)
      expect(get.body).not.toContain('<script>')
      expect(get.body).not.toContain('<img')
      expect(get.body).toContain('&lt;img')
    })

    it('POST without the csrf cookie, or with a mismatched token, is rejected', async () => {
      const { csrf } = await consent()
      const bad: MockRes['req'][] = [
        { method: 'POST', headers: {}, body: { consent: 'approve', csrf } },
        { method: 'POST', headers: { cookie: 'mcp_consent=other' }, body: { consent: 'approve', csrf } },
        { method: 'POST', headers: { cookie: `mcp_consent=${csrf}` }, body: { consent: 'approve' } },
      ]
      for (const req of bad) {
        const res = mockRes(req)
        await expect(provider.authorize(client, authParams(), res as never)).rejects.toThrow(/consent/i)
        expect(res.redirect).not.toHaveBeenCalled()
      }
      expect(store.oauth.consumePending('x', clock)).toBeNull()
    })

    it('deny redirects back to the client with access_denied and stores nothing', async () => {
      const post = await approve(authParams(), 'deny')
      const url = new URL(post.redirect.mock.calls[0]![0] as string)
      expect(url.origin).toBe('http://localhost:9999')
      expect(url.searchParams.get('error')).toBe('access_denied')
      expect(url.searchParams.get('state')).toBe('client-state')
    })

    it('approval redirects to discord with prompt=consent and sets the state cookie', async () => {
      const url = await startAuth()
      expect(url.searchParams.get('prompt')).toBe('consent')
      expect(browserState).toBe(url.searchParams.get('state'))
    })

    it('callback state must match the browser cookie', async () => {
      const url = await startAuth()
      const state = url.searchParams.get('state')!
      await expect(provider.handleDiscordCallback({ code: 'admin', state, browserState: undefined })).rejects.toThrow(/browser/)
      await expect(callback('admin', state, 'different')).rejects.toThrow(/browser/)
      expect(exchangeSpy).not.toHaveBeenCalled()
      await expect(callback('admin', state)).resolves.toBeTruthy()
    })

    it('enforces http.allowed_redirect_uris at authorize', async () => {
      store = openStore(':memory:')
      provider = createAuthProvider({
        store, discordOAuth, discord: { listBotGuildIds: async () => botGuilds }, policy: { guildAllowed: () => true },
        config: { publicBaseUrl: BASE, discordClientId: 'dcid', allowedRedirectUris: ['https://only.example/cb'] }, now: () => clock,
      })
      const c = await createClientsStore(store).registerClient!({ redirect_uris: [REDIRECT], client_name: 'c' } as never)
      const res = mockRes({ method: 'GET', headers: {} })
      await expect(provider.authorize(c, { redirectUri: REDIRECT, codeChallenge: CHALLENGE } as never, res as never)).rejects.toThrow(/policy/)
    })

    it('registeredOrigins is cached and invalidated on registration', async () => {
      const first = provider.registeredOrigins()
      expect(provider.registeredOrigins()).toBe(first)
      await provider.clientsStore.registerClient!({ redirect_uris: ['https://new.example/cb'], client_name: 'n' } as never)
      expect(provider.registeredOrigins().has('https://new.example')).toBe(true)
    })
  })

  describe('authorize', () => {
    it('redirects to discord with identify+guilds scope and stores pending state', async () => {
      const url = await startAuth()
      expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize')
      expect(url.searchParams.get('response_type')).toBe('code')
      expect(url.searchParams.get('client_id')).toBe('dcid')
      expect(url.searchParams.get('scope')).toBe('identify guilds')
      expect(url.searchParams.get('redirect_uri')).toBe(`${BASE}/callback`)
      const state = url.searchParams.get('state')!
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/)
      const pending = store.oauth.consumePending(state, clock)
      expect(pending).toMatchObject({ clientId: client.client_id, redirectUri: REDIRECT, codeChallenge: CHALLENGE, clientState: 'client-state', expiresAt: clock + 600_000 })
    })

    it('rejects an unregistered redirect uri', async () => {
      await expect(startAuth({ redirectUri: 'http://localhost:9999/other' })).rejects.toThrow(/redirect/i)
    })

    it('rejects a redirect uri differing only by port', async () => {
      await expect(startAuth({ redirectUri: 'http://localhost:1234/cb' })).rejects.toThrow(/redirect/i)
    })

    it('rejects a missing code challenge', async () => {
      await expect(startAuth({ codeChallenge: '' })).rejects.toThrow(/code_challenge|PKCE/i)
    })
  })

  describe('discord callback', () => {
    it('issues an auth code carrying only admin guilds that the bot is in and policy allows', async () => {
      const cb = await login('admin')
      expect(cb.origin + cb.pathname).toBe(REDIRECT)
      expect(cb.searchParams.get('state')).toBe('client-state')
      const code = cb.searchParams.get('code')!
      const stored = store.oauth.consumeCode(hashSecret(code), clock)!
      expect(stored.userId).toBe('u1')
      expect(stored.userName).toBe('alice')
      expect(Object.keys(stored.guilds).sort()).toEqual([G1, G2])
      expect(stored.guilds[G1]).toBe(perms(PERM.ADMINISTRATOR))
      expect(stored.expiresAt).toBe(clock + 300_000)
    })

    it('excludes guilds not in policy even if bot is present', async () => {
      allowed.delete(G2)
      build()
      const code = (await login('admin')).searchParams.get('code')!
      expect(Object.keys(store.oauth.consumeCode(hashSecret(code), clock)!.guilds)).toEqual([G1])
    })

    it('denies a user with no admin or manage_guild permission', async () => {
      const cb = await login('plain')
      expect(cb.searchParams.get('error')).toBe('access_denied')
      expect(cb.searchParams.get('state')).toBe('client-state')
      expect(cb.searchParams.get('code')).toBeNull()
    })

    it('denies an admin of guilds the bot is not in', async () => {
      botGuilds = []
      build()
      expect((await login('admin')).searchParams.get('error')).toBe('access_denied')
    })

    it('denies an admin when policy allows none of their guilds', async () => {
      allowed.clear()
      build()
      expect((await login('admin')).searchParams.get('error')).toBe('access_denied')
    })

    it('redirects access_denied when discord rejects the code', async () => {
      expect((await login('bogus')).searchParams.get('error')).toBe('access_denied')
    })

    it('rejects an unknown state', async () => {
      await expect(callback('admin', 'nope')).rejects.toThrow()
      expect(exchangeSpy).not.toHaveBeenCalled()
    })

    it('rejects a replayed state', async () => {
      const url = await startAuth()
      const state = url.searchParams.get('state')!
      await callback('admin', state)
      await expect(callback('admin', state)).rejects.toThrow()
    })

    it('rejects an expired state', async () => {
      const url = await startAuth()
      clock += 600_001
      await expect(callback('admin', url.searchParams.get('state')!)).rejects.toThrow()
    })

    it('omits state when the client sent none', async () => {
      const post = await approve({ redirectUri: REDIRECT, codeChallenge: CHALLENGE } as never)
      const state = new URL(post.redirect.mock.calls[0]![0] as string).searchParams.get('state')!
      const { redirectTo } = await callback('admin', state)
      expect(new URL(redirectTo).searchParams.has('state')).toBe(false)
    })
  })

  describe('code exchange', () => {
    it('challengeForAuthorizationCode returns the stored challenge without consuming', async () => {
      const code = (await login()).searchParams.get('code')!
      expect(await provider.challengeForAuthorizationCode(client, code)).toBe(CHALLENGE)
      expect(await provider.challengeForAuthorizationCode(client, code)).toBe(CHALLENGE)
      await expect(provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)).resolves.toBeTruthy()
    })

    it('rejects challenge lookup for unknown code and other client', async () => {
      await expect(provider.challengeForAuthorizationCode(client, 'nope')).rejects.toThrow()
      const code = (await login()).searchParams.get('code')!
      await expect(provider.challengeForAuthorizationCode({ ...client, client_id: 'other' }, code)).rejects.toThrow()
    })

    it('mints hashed access and refresh tokens once', async () => {
      const t = await tokensFor()
      expect(t.token_type).toBe('Bearer')
      expect(t.expires_in).toBe(3600)
      const session = store.oauth.getByAccessHash(hashSecret(t.access_token))!
      expect(session.accessExpiresAt).toBe(clock + 3_600_000)
      expect(session.refreshExpiresAt).toBe(clock + 30 * 86_400_000)
      expect(session.refreshHash).toBe(hashSecret(t.refresh_token!))
      expect(session.userName).toBe('alice')
      expect(JSON.stringify(session)).not.toContain(t.access_token)
      expect(JSON.stringify(session)).not.toContain(t.refresh_token!)
    })

    it('code replay revokes the family it issued', async () => {
      const code = (await login()).searchParams.get('code')!
      const t = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)
      await expect(provider.challengeForAuthorizationCode(client, code)).rejects.toThrow()
      await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow()
      await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toThrow()
    })

    it('exchange without redirect_uri is rejected', async () => {
      const code = (await login()).searchParams.get('code')!
      await expect(provider.exchangeAuthorizationCode(client, code, undefined, undefined)).rejects.toThrow(/redirect_uri/)
    })

    it('rejects code replay', async () => {
      const code = (await login()).searchParams.get('code')!
      await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)
      await expect(provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)).rejects.toThrow()
    })

    it('rejects an expired code', async () => {
      const code = (await login()).searchParams.get('code')!
      clock += 300_001
      await expect(provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)).rejects.toThrow()
    })

    it('rejects a code for another client or redirect uri', async () => {
      const code = (await login()).searchParams.get('code')!
      await expect(provider.exchangeAuthorizationCode({ ...client, client_id: 'other' }, code, undefined, REDIRECT)).rejects.toThrow()
      await expect(provider.exchangeAuthorizationCode(client, code, undefined, 'http://localhost:9999/x')).rejects.toThrow()
    })

    it('error messages never contain codes or tokens', async () => {
      const code = (await login()).searchParams.get('code')!
      await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)
      const err = await provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT).catch((e: Error) => e)
      expect(String((err as Error).message)).not.toContain(code)
    })
  })

  describe('refresh', () => {
    it('rotates tokens and invalidates the old ones', async () => {
      const t1 = await tokensFor()
      clock += 1000
      const t2 = await provider.exchangeRefreshToken(client, t1.refresh_token!)
      expect(t2.access_token).not.toBe(t1.access_token)
      expect(t2.refresh_token).not.toBe(t1.refresh_token)
      expect(store.oauth.getByAccessHash(hashSecret(t1.access_token))).toBeNull()
      expect(store.oauth.getByAccessHash(hashSecret(t2.access_token))).not.toBeNull()
      await expect(provider.verifyAccessToken(t2.access_token)).resolves.toMatchObject({ clientId: client.client_id })
    })

    it('a retry of the previous refresh token within 10s returns the same pair; later it is reuse', async () => {
      const t1 = await tokensFor()
      const t2 = await provider.exchangeRefreshToken(client, t1.refresh_token!)
      clock += 5_000
      expect(await provider.exchangeRefreshToken(client, t1.refresh_token!)).toEqual(t2)
      await expect(provider.verifyAccessToken(t2.access_token)).resolves.toBeTruthy()
      clock += 6_000
      await expect(provider.exchangeRefreshToken(client, t1.refresh_token!)).rejects.toThrow(/reuse/)
      await expect(provider.verifyAccessToken(t2.access_token)).rejects.toThrow()
    })

    it('grace does not apply after the new token was revoked or to another client', async () => {
      const t1 = await tokensFor()
      const t2 = await provider.exchangeRefreshToken(client, t1.refresh_token!)
      await provider.revokeToken!(client, { token: t2.refresh_token! } as never)
      await expect(provider.exchangeRefreshToken(client, t1.refresh_token!)).rejects.toThrow()
    })

    it('reuse of a rotated refresh token revokes the whole family', async () => {
      const t1 = await tokensFor()
      const t2 = await provider.exchangeRefreshToken(client, t1.refresh_token!)
      clock += 11_000
      await expect(provider.exchangeRefreshToken(client, t1.refresh_token!)).rejects.toMatchObject({ errorCode: 'invalid_grant' })
      await expect(provider.exchangeRefreshToken(client, t2.refresh_token!)).rejects.toMatchObject({ errorCode: 'invalid_grant' })
      await expect(provider.verifyAccessToken(t2.access_token)).rejects.toThrow()
    })

    it('rejects unknown, expired and other-client refresh tokens', async () => {
      await expect(provider.exchangeRefreshToken(client, 'nope')).rejects.toMatchObject({ errorCode: 'invalid_grant' })
      const t = await tokensFor()
      await expect(provider.exchangeRefreshToken({ ...client, client_id: 'other' }, t.refresh_token!)).rejects.toMatchObject({ errorCode: 'invalid_grant' })
      clock += 30 * 86_400_000 + 1
      await expect(provider.exchangeRefreshToken(client, t.refresh_token!)).rejects.toMatchObject({ errorCode: 'invalid_grant' })
    })

    it('applies beforeIssue permission updates', async () => {
      beforeIssue = async (s) => ({ ...s, guilds: { [G1]: s.guilds[G1]! } })
      build()
      const t1 = await tokensFor()
      const t2 = await provider.exchangeRefreshToken(client, t1.refresh_token!)
      expect(Object.keys(store.oauth.getByAccessHash(hashSecret(t2.access_token))!.guilds)).toEqual([G1])
    })

    it('rotates before refreshing guilds so a slow refresh cannot orphan the family', async () => {
      const t1 = await tokensFor()
      let sawRotated = false
      beforeIssue = async (s) => {
        sawRotated = store.oauth.getByRefreshHash(hashSecret(t1.refresh_token!)) === null && s.refreshHash !== hashSecret(t1.refresh_token!)
        return s
      }
      build()
      await provider.exchangeRefreshToken(client, t1.refresh_token!)
      expect(sawRotated).toBe(true)
    })

    it('revokes the family when beforeIssue leaves no guilds', async () => {
      beforeIssue = async (s) => ({ ...s, guilds: {} })
      build()
      const t1 = await tokensFor()
      await expect(provider.exchangeRefreshToken(client, t1.refresh_token!)).rejects.toMatchObject({ errorCode: 'invalid_grant' })
      await expect(provider.verifyAccessToken(t1.access_token)).rejects.toThrow()
    })
  })

  describe('verify and revoke', () => {
    it('verifies a live access token', async () => {
      const t = await tokensFor()
      const info = await provider.verifyAccessToken(t.access_token)
      expect(info.clientId).toBe(client.client_id)
      expect(info.expiresAt).toBe(Math.floor((clock + 3_600_000) / 1000))
    })

    it('rejects unknown and expired access tokens', async () => {
      await expect(provider.verifyAccessToken('nope')).rejects.toThrow()
      const t = await tokensFor()
      clock += 3_600_001
      await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow()
    })

    it('revoked token no longer verifies', async () => {
      const t = await tokensFor()
      await provider.revokeToken!(client, { token: t.access_token } as never)
      await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow()
    })

    it('revoking the refresh token kills the session', async () => {
      const t = await tokensFor()
      await provider.revokeToken!(client, { token: t.refresh_token! } as never)
      await expect(provider.verifyAccessToken(t.access_token)).rejects.toThrow()
    })

    it('another client cannot revoke the token', async () => {
      const t = await tokensFor()
      await provider.revokeToken!({ ...client, client_id: 'other' }, { token: t.access_token } as never)
      await expect(provider.verifyAccessToken(t.access_token)).resolves.toBeTruthy()
    })

    it('revoking an unknown token is a no-op', async () => {
      await expect(provider.revokeToken!(client, { token: 'nope' } as never)).resolves.toBeUndefined()
    })
  })
})
