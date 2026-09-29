import express from 'express'
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js'
import { OAuthError, ServerError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { AuthProvider } from './provider.js'

const single = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null)

export const createAuthRouter = (provider: AuthProvider, d: { publicBaseUrl: string }): express.Router => {
  const router = express.Router()
  const base = new URL(d.publicBaseUrl)

  router.use(mcpAuthRouter({ provider, issuerUrl: base, resourceServerUrl: base, resourceName: 'discord-mcp' }))

  router.get('/callback', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    const code = single(req.query.code)
    const state = single(req.query.state)
    try {
      if (!code || !state) {
        res.status(400).json({ error: 'invalid_request', error_description: 'code and state are required' })
        return
      }
      const { redirectTo } = await provider.handleDiscordCallback({ code, state })
      res.redirect(302, redirectTo)
    } catch (err) {
      const e = err instanceof OAuthError ? err : new ServerError('Internal Server Error')
      res.status(e instanceof ServerError ? 500 : 400).json(e.toResponseObject())
    }
  })

  return router
}
