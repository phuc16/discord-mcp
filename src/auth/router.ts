import { randomUUID } from 'node:crypto'
import express from 'express'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { OAuthError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthRouterOptions } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { STATE_COOKIE, parseCookies } from './provider.js'
import type { AuthProvider } from './provider.js'

const single = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

type Limit = NonNullable<NonNullable<AuthRouterOptions['tokenOptions']>['rateLimit']>

export interface AuthRateLimits {
  authorize?: Limit
  token?: Limit
  register?: Limit
  revoke?: Limit
}

export const createAuthRouter = (provider: AuthProvider, d: { publicBaseUrl: string; rateLimits?: AuthRateLimits }): express.Router => {
  const router = express.Router()
  const base = new URL(d.publicBaseUrl)

  for (const path of ['/token', '/register', '/revoke']) {
    router.use(path, (req, res, next) => {
      const origin = req.headers.origin
      const allowed = origin !== undefined && provider.registeredOrigins().has(origin)
      const setHeader = res.setHeader.bind(res)
      res.setHeader = ((name: string, value: number | string | readonly string[]) => {
        if (name.toLowerCase() !== 'access-control-allow-origin') return setHeader(name, value)
        if (allowed) {
          setHeader('Vary', 'Origin')
          return setHeader(name, origin)
        }
        return res
      }) as typeof res.setHeader
      next()
    })
  }

  router.use(mcpAuthRouter({ provider, issuerUrl: base, resourceServerUrl: base, resourceName: 'discord-mcp',
    ...(d.rateLimits && {
      authorizationOptions: { rateLimit: d.rateLimits.authorize },
      tokenOptions: { rateLimit: d.rateLimits.token },
      clientRegistrationOptions: { rateLimit: d.rateLimits.register },
      revocationOptions: { rateLimit: d.rateLimits.revoke },
    }),
  }))

  router.get('/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const code = single(req.query.code)
    const state = single(req.query.state)
    try {
      if (!code || !state) {
        res.status(400).json({ error: 'invalid_request', error_description: 'code and state are required' })
        return
      }
      const browserState = parseCookies(req.headers.cookie)[STATE_COOKIE]
      res.setHeader('Set-Cookie', `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/callback; Max-Age=0${base.protocol === 'https:' ? '; Secure' : ''}`)
      const { redirectTo } = await provider.handleDiscordCallback({ code, state, browserState, correlationId: randomUUID(), requestId: typeof req.headers['x-request-id'] === 'string' ? req.headers['x-request-id'].slice(0, 64).replace(/[^\w.-]/g, '_') : undefined })
      res.redirect(302, redirectTo)
    } catch (err) {
      const e = err instanceof OAuthError ? err : new ServerError('Internal Server Error')
      res.status(e instanceof ServerError ? 500 : 400).json(e.toResponseObject())
    }
  })

  return router
}
