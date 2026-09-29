import { timingSafeEqual } from 'node:crypto'
import type { RequestHandler } from 'express'
import type { Config, Principal } from '../contracts/index.js'
import type { Store } from '../store/index.js'
import { principalFromServiceToken, principalFromSession } from './principal.js'
import { hashSecret } from './tokens.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      principal?: Principal
    }
  }
}

const BEARER = /^Bearer (.+)$/i

const equalHex = (a: string, b: string): boolean => {
  const x = Buffer.from(a, 'hex')
  const y = Buffer.from(b, 'hex')
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

export const createBearerMiddleware = (d: {
  store: Store
  serviceTokens: Config['http']['service_tokens']
  publicBaseUrl: string
  now?: () => number
}): RequestHandler => {
  const now = d.now ?? Date.now
  const challenge = `Bearer resource_metadata="${d.publicBaseUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource"`

  const resolve = (token: string): Principal | null => {
    const hash = hashSecret(token)
    const session = d.store.oauth.getByAccessHash(hash)
    if (session && !session.revoked && session.accessExpiresAt > now()) return principalFromSession(session)
    let matched: string | null = null
    for (const t of d.serviceTokens) {
      if (equalHex(hash, t.sha256) && matched === null) matched = t.name
    }
    return matched === null ? null : principalFromServiceToken(matched)
  }

  return (req, res, next) => {
    const token = BEARER.exec(req.headers.authorization ?? '')?.[1]?.trim()
    const principal = token ? resolve(token) : null
    if (!principal) {
      res.status(401).set('WWW-Authenticate', challenge).json({ error: 'unauthorized' })
      return
    }
    req.principal = principal
    next()
  }
}
