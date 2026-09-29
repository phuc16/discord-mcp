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

  const startAuth = async (over: { redirectUri?: string; codeChallenge?: string; state?: string } = {}) => {
    const res = { redirect: vi.fn() }
    await provider.authorize(client, { redirectUri: over.redirectUri ?? REDIRECT, codeChallenge: over.codeChallenge ?? CHALLENGE, state: over.state ?? 'client-state' } as never, res as never)
    const url = new URL(res.redirect.mock.calls[0]![0] as string)
    return url
  }

  const login = async (discordCode = 'admin') => {
    const url = await startAuth()
    const { redirectTo } = await provider.handleDiscordCallback({ code: discordCode, state: url.searchParams.get('state')! })
    return new URL(redirectTo)
  }

  const tokensFor = async (discordCode = 'admin') => {
    const cb = await login(discordCode)
    const code = cb.searchParams.get('code')!
    return provider.exchangeAuthorizationCode(client, code, undefined, REDIRECT)
  }

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
      await expect(provider.handleDiscordCallback({ code: 'admin', state: 'nope' })).rejects.toThrow()
      expect(exchangeSpy).not.toHaveBeenCalled()
    })

    it('rejects a replayed state', async () => {
      const url = await startAuth()
      const state = url.searchParams.get('state')!
      await provider.handleDiscordCallback({ code: 'admin', state })
      await expect(provider.handleDiscordCallback({ code: 'admin', state })).rejects.toThrow()
    })

    it('rejects an expired state', async () => {
      const url = await startAuth()
      clock += 600_001
      await expect(provider.handleDiscordCallback({ code: 'admin', state: url.searchParams.get('state')! })).rejects.toThrow()
    })

    it('omits state when the client sent none', async () => {
      const res = { redirect: vi.fn() }
      await provider.authorize(client, { redirectUri: REDIRECT, codeChallenge: CHALLENGE } as never, res as never)
      const state = new URL(res.redirect.mock.calls[0]![0] as string).searchParams.get('state')!
      const { redirectTo } = await provider.handleDiscordCallback({ code: 'admin', state })
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

    it('reuse of a rotated refresh token revokes the whole family', async () => {
      const t1 = await tokensFor()
      const t2 = await provider.exchangeRefreshToken(client, t1.refresh_token!)
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
