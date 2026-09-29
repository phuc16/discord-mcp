import { randomUUID } from 'node:crypto'
import type { Response } from 'express'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import { InvalidGrantError, InvalidRequestError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { McpToolError } from '../contracts/index.js'
import type { DiscordOAuthPort, DiscordPort } from '../contracts/index.js'
import type { Session, Store } from '../store/index.js'
import { createClientsStore } from './clients-store.js'
import { hashSecret, newToken } from './tokens.js'

const ADMINISTRATOR = 1n << 3n
const MANAGE_GUILD = 1n << 5n
const STATE_TTL_MS = 10 * 60_000
const CODE_TTL_MS = 5 * 60_000
const ACCESS_TTL_MS = 60 * 60_000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000

export interface AuthProvider extends OAuthServerProvider {
  handleDiscordCallback(req: { code: string; state: string }): Promise<{ redirectTo: string }>
}

export interface AuthProviderDeps {
  store: Store
  discordOAuth: DiscordOAuthPort
  discord: Pick<DiscordPort, 'listBotGuildIds'>
  policy: { guildAllowed(guildId: string): boolean }
  config: { publicBaseUrl: string; discordClientId: string }
  now?: () => number
  beforeIssue?: (session: Session) => Promise<Session>
}

const isManager = (permissions: string): boolean => {
  try {
    const bits = BigInt(permissions)
    return (bits & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n
  } catch {
    return false
  }
}

const clientRedirect = (redirectUri: string, params: Record<string, string | null>): string => {
  const url = new URL(redirectUri)
  for (const [k, v] of Object.entries(params)) if (v !== null) url.searchParams.set(k, v)
  return url.toString()
}

export const createAuthProvider = (d: AuthProviderDeps): AuthProvider => {
  const now = d.now ?? Date.now
  const clientsStore = createClientsStore(d.store)
  const callbackUrl = `${d.config.publicBaseUrl.replace(/\/$/, '')}/callback`

  const issueTokens = (s: Omit<Session, 'accessHash' | 'refreshHash' | 'accessExpiresAt' | 'refreshExpiresAt' | 'revoked'>): OAuthTokens => {
    const access = newToken()
    const refresh = newToken()
    d.store.oauth.saveSession({
      ...s,
      accessHash: hashSecret(access),
      refreshHash: hashSecret(refresh),
      accessExpiresAt: now() + ACCESS_TTL_MS,
      refreshExpiresAt: now() + REFRESH_TTL_MS,
      revoked: false,
    })
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh }
  }

  return {
    get clientsStore(): OAuthRegisteredClientsStore {
      return clientsStore
    },

    async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
      if (!client.redirect_uris.some((u) => String(u) === params.redirectUri)) {
        throw new InvalidRequestError('redirect_uri is not registered for this client')
      }
      if (!params.codeChallenge) throw new InvalidRequestError('PKCE code_challenge is required')
      const state = newToken()
      d.store.oauth.savePending({
        state,
        clientId: client.client_id,
        redirectUri: params.redirectUri,
        codeChallenge: params.codeChallenge,
        clientState: params.state ?? null,
        scopes: params.scopes ?? [],
        expiresAt: now() + STATE_TTL_MS,
      })
      const url = new URL('https://discord.com/oauth2/authorize')
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', d.config.discordClientId)
      url.searchParams.set('scope', 'identify guilds')
      url.searchParams.set('redirect_uri', callbackUrl)
      url.searchParams.set('state', state)
      res.redirect(url.toString())
    },

    async handleDiscordCallback(req) {
      const pending = d.store.oauth.consumePending(req.state, now())
      if (!pending) throw new InvalidRequestError('unknown or expired state')
      const back = (params: Record<string, string>): { redirectTo: string } => ({
        redirectTo: clientRedirect(pending.redirectUri, { ...params, state: pending.clientState }),
      })
      try {
        const { accessToken } = await d.discordOAuth.exchangeCode(req.code, callbackUrl)
        const [user, userGuilds, botGuildIds] = await Promise.all([
          d.discordOAuth.fetchUser(accessToken),
          d.discordOAuth.fetchUserGuilds(accessToken),
          d.discord.listBotGuildIds(),
        ])
        const botGuilds = new Set(botGuildIds)
        const guilds: Record<string, string> = {}
        for (const g of userGuilds) {
          if (isManager(g.permissions) && botGuilds.has(g.id) && d.policy.guildAllowed(g.id)) guilds[g.id] = g.permissions
        }
        if (Object.keys(guilds).length === 0) return back({ error: 'access_denied' })
        const code = newToken()
        d.store.oauth.saveCode({
          codeHash: hashSecret(code),
          clientId: pending.clientId,
          redirectUri: pending.redirectUri,
          codeChallenge: pending.codeChallenge,
          userId: user.id,
          userName: user.username,
          guilds,
          expiresAt: now() + CODE_TTL_MS,
        })
        return back({ code })
      } catch (err) {
        return back({ error: err instanceof McpToolError && err.code === 'unauthorized' ? 'access_denied' : 'server_error' })
      }
    },

    async challengeForAuthorizationCode(client, authorizationCode) {
      const c = d.store.oauth.peekCode(hashSecret(authorizationCode), now())
      if (!c || c.clientId !== client.client_id) throw new InvalidGrantError('invalid authorization code')
      return c.codeChallenge
    },

    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
      const c = d.store.oauth.consumeCode(hashSecret(authorizationCode), now())
      if (!c || c.clientId !== client.client_id) throw new InvalidGrantError('invalid authorization code')
      if (redirectUri !== undefined && redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri mismatch')
      return issueTokens({ familyId: randomUUID(), clientId: c.clientId, userId: c.userId, userName: c.userName, guilds: c.guilds })
    },

    async exchangeRefreshToken(client, refreshToken) {
      const oldRefreshHash = hashSecret(refreshToken)
      const current = d.store.oauth.getByRefreshHash(oldRefreshHash)
      if (current && current.clientId !== client.client_id) throw new InvalidGrantError('invalid refresh token')
      let guilds = current?.guilds ?? {}
      if (current && !current.revoked && current.refreshExpiresAt > now() && d.beforeIssue) {
        guilds = (await d.beforeIssue(current)).guilds
        if (Object.keys(guilds).length === 0) {
          d.store.oauth.revokeFamily(current.familyId)
          throw new InvalidGrantError('invalid refresh token')
        }
      }
      const access = newToken()
      const refresh = newToken()
      const rotated = d.store.oauth.rotateRefresh({
        oldRefreshHash,
        newRefreshHash: hashSecret(refresh),
        newAccessHash: hashSecret(access),
        accessExpiresAt: now() + ACCESS_TTL_MS,
        refreshExpiresAt: now() + REFRESH_TTL_MS,
        guilds,
        now: now(),
      })
      if (!rotated) throw new InvalidGrantError('invalid refresh token')
      if ('reuse' in rotated) throw new InvalidGrantError('refresh token reuse detected')
      return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh }
    },

    async verifyAccessToken(token): Promise<AuthInfo> {
      const s = d.store.oauth.getByAccessHash(hashSecret(token))
      if (!s || s.revoked || s.accessExpiresAt <= now()) throw new InvalidTokenError('invalid or expired access token')
      return {
        token,
        clientId: s.clientId,
        scopes: [],
        expiresAt: s.accessExpiresAt / 1000,
        extra: { userId: s.userId, userName: s.userName, guilds: s.guilds, familyId: s.familyId },
      }
    },

    async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
      const h = hashSecret(request.token)
      const s = d.store.oauth.getByAccessHash(h) ?? d.store.oauth.getByRefreshHash(h)
      if (!s || s.clientId !== client.client_id) return
      d.store.oauth.revokeByTokenHash(h)
    },
  }
}
