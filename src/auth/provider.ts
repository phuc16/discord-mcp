import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { Response } from 'express'
import type { AuthorizationParams, OAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/provider.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import { InvalidGrantError, InvalidRequestError, InvalidTokenError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js'
import type { OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js'
import { McpToolError } from '../contracts/index.js'
import type { DiscordOAuthPort, DiscordPort } from '../contracts/index.js'
import type { Session, Store } from '../store/index.js'
import { createClientsStore, redirectUriAllowed } from './clients-store.js'
import { renderConsentPage } from './consent.js'
import { hashSecret, newToken } from './tokens.js'

const ADMINISTRATOR = 1n << 3n
const MANAGE_GUILD = 1n << 5n
const STATE_TTL_MS = 10 * 60_000
const CODE_TTL_MS = 5 * 60_000
const ACCESS_TTL_MS = 60 * 60_000
const REFRESH_TTL_MS = 30 * 24 * 60 * 60_000
const ORIGINS_TTL_MS = 60_000
const REFRESH_GRACE_MS = 10_000
export const CONSENT_COOKIE = 'mcp_consent'
export const STATE_COOKIE = 'mcp_oauth_state'

export const parseCookies = (header: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim()
  }
  return out
}

const safeEqual = (a: string | undefined, b: string | undefined): boolean => {
  if (a === undefined || b === undefined || a.length === 0) return false
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  return ab.length === bb.length && timingSafeEqual(ab, bb)
}

const bodyField = (req: Response['req'] | undefined, name: string): string | undefined => {
  const v = (req?.body as Record<string, unknown> | undefined)?.[name]
  return typeof v === 'string' ? v : undefined
}

export interface AuthProvider extends OAuthServerProvider {
  handleDiscordCallback(req: { code: string; state: string; browserState: string | undefined }): Promise<{ redirectTo: string }>
  registeredOrigins(): ReadonlySet<string>
}

export interface AuthProviderDeps {
  store: Store
  discordOAuth: DiscordOAuthPort
  discord: Pick<DiscordPort, 'listBotGuildIds'>
  policy: { guildAllowed(guildId: string): boolean }
  config: { publicBaseUrl: string; discordClientId: string; allowedRedirectUris?: string[]; maxClients?: number }
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
  const cookieFlags = d.config.publicBaseUrl.startsWith('https:') ? '; Secure' : ''
  const graceTokens = new Map<string, { clientId: string; tokens: OAuthTokens; newRefreshHash: string; expiresAt: number }>()
  let originsCache: { at: number; origins: Set<string> } | null = null
  const baseClients = createClientsStore(d.store, { allowedRedirectUris: d.config.allowedRedirectUris, maxClients: d.config.maxClients })
  const clientsStore: OAuthRegisteredClientsStore = {
    getClient: (id) => baseClients.getClient(id),
    registerClient: async (c) => {
      const registered = await baseClients.registerClient!(c)
      originsCache = null
      return registered
    },
  }
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
      if (!redirectUriAllowed(params.redirectUri, d.config.allowedRedirectUris ?? [])) {
        throw new InvalidRequestError('redirect_uri is not allowed by server policy')
      }
      if (!params.codeChallenge) throw new InvalidRequestError('PKCE code_challenge is required')
      const req = res.req as Response['req'] | undefined
      const decision = req?.method === 'POST' ? bodyField(req, 'consent') : undefined
      res.setHeader('Cache-Control', 'no-store')
      res.setHeader('X-Frame-Options', 'DENY')
      res.setHeader('Referrer-Policy', 'no-referrer')

      if (decision === undefined) {
        const csrf = newToken()
        res.setHeader('Set-Cookie', `${CONSENT_COOKIE}=${csrf}; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=600${cookieFlags}`)
        res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://discord.com; frame-ancestors 'none'; base-uri 'none'")
        res.status(200).type('html').send(
          renderConsentPage({
            clientName: client.client_name ?? '',
            redirectUri: params.redirectUri,
            csrf,
            fields: {
              client_id: client.client_id,
              redirect_uri: params.redirectUri,
              response_type: 'code',
              code_challenge: params.codeChallenge,
              code_challenge_method: 'S256',
              ...(params.state !== undefined && { state: params.state }),
              ...(params.scopes && params.scopes.length > 0 && { scope: params.scopes.join(' ') }),
              ...(params.resource && { resource: params.resource.href }),
            },
          }),
        )
        return
      }

      const csrfCookie = parseCookies(req?.headers.cookie)[CONSENT_COOKIE]
      if (!safeEqual(csrfCookie, bodyField(req, 'csrf'))) throw new InvalidRequestError('invalid or missing consent token')
      res.setHeader('Set-Cookie', `${CONSENT_COOKIE}=; HttpOnly; SameSite=Lax; Path=/authorize; Max-Age=0${cookieFlags}`)
      if (decision !== 'approve') {
        res.redirect(clientRedirect(params.redirectUri, { error: 'access_denied', state: params.state ?? null }))
        return
      }

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
      res.appendHeader('Set-Cookie', `${STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/callback; Max-Age=${STATE_TTL_MS / 1000}${cookieFlags}`)
      const url = new URL('https://discord.com/oauth2/authorize')
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', d.config.discordClientId)
      url.searchParams.set('scope', 'identify guilds')
      url.searchParams.set('redirect_uri', callbackUrl)
      url.searchParams.set('state', state)
      url.searchParams.set('prompt', 'consent')
      res.redirect(url.toString())
    },

    registeredOrigins() {
      if (originsCache && now() - originsCache.at < ORIGINS_TTL_MS) return originsCache.origins
      const origins = new Set<string>()
      for (const c of d.store.oauth.listClients()) {
        for (const uri of c.redirectUris) {
          try {
            origins.add(new URL(uri).origin)
          } catch {
            continue
          }
        }
      }
      originsCache = { at: now(), origins }
      return origins
    },

    async handleDiscordCallback(req) {
      if (!safeEqual(req.browserState, req.state)) throw new InvalidRequestError('state does not match this browser session')
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
      const hash = hashSecret(authorizationCode)
      const c = d.store.oauth.peekCode(hash, now())
      if (!c) {
        const family = d.store.oauth.familyForUsedCode(hash)
        if (family !== null) d.store.oauth.revokeFamily(family)
        throw new InvalidGrantError('invalid authorization code')
      }
      if (c.clientId !== client.client_id) throw new InvalidGrantError('invalid authorization code')
      return c.codeChallenge
    },

    async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri) {
      const hash = hashSecret(authorizationCode)
      const c = d.store.oauth.consumeCode(hash, now())
      if (!c) {
        const family = d.store.oauth.familyForUsedCode(hash)
        if (family !== null) d.store.oauth.revokeFamily(family)
        throw new InvalidGrantError('invalid authorization code')
      }
      if (c.clientId !== client.client_id) throw new InvalidGrantError('invalid authorization code')
      if (redirectUri === undefined || redirectUri !== c.redirectUri) throw new InvalidGrantError('redirect_uri mismatch')
      const familyId = randomUUID()
      const tokens = issueTokens({ familyId, clientId: c.clientId, userId: c.userId, userName: c.userName, guilds: c.guilds })
      d.store.oauth.recordCodeFamily(hash, familyId)
      return tokens
    },

    async exchangeRefreshToken(client, refreshToken) {
      const oldRefreshHash = hashSecret(refreshToken)
      for (const [h, g] of graceTokens) if (g.expiresAt <= now()) graceTokens.delete(h)
      const graced = graceTokens.get(oldRefreshHash)
      if (graced && graced.clientId === client.client_id) {
        const live = d.store.oauth.getByRefreshHash(graced.newRefreshHash)
        if (live && !live.revoked) return graced.tokens
      }
      const current = d.store.oauth.getByRefreshHash(oldRefreshHash)
      if (current && current.clientId !== client.client_id) throw new InvalidGrantError('invalid refresh token')
      const access = newToken()
      const refresh = newToken()
      const rotated = d.store.oauth.rotateRefresh({
        oldRefreshHash,
        newRefreshHash: hashSecret(refresh),
        newAccessHash: hashSecret(access),
        accessExpiresAt: now() + ACCESS_TTL_MS,
        refreshExpiresAt: now() + REFRESH_TTL_MS,
        guilds: current?.guilds ?? {},
        now: now(),
      })
      if (!rotated) throw new InvalidGrantError('invalid refresh token')
      if ('reuse' in rotated) throw new InvalidGrantError('refresh token reuse detected')
      if (d.beforeIssue) {
        const refreshed = await d.beforeIssue(rotated.session)
        if (Object.keys(refreshed.guilds).length === 0) {
          d.store.oauth.revokeFamily(rotated.session.familyId)
          throw new InvalidGrantError('invalid refresh token')
        }
        d.store.oauth.updateSessionGuilds(rotated.session.familyId, refreshed.guilds)
      }
      const tokens: OAuthTokens = { access_token: access, token_type: 'Bearer', expires_in: ACCESS_TTL_MS / 1000, refresh_token: refresh }
      graceTokens.set(oldRefreshHash, { clientId: client.client_id, tokens, newRefreshHash: hashSecret(refresh), expiresAt: now() + REFRESH_GRACE_MS })
      return tokens
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
