import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createBearerMiddleware } from '../../../src/auth/bearer.js'
import { hashSecret } from '../../../src/auth/tokens.js'
import type { Principal } from '../../../src/contracts/index.js'
import { openStore } from '../../../src/store/index.js'
import type { Store } from '../../../src/store/index.js'

const BASE = 'https://mcp.example.com'
const SERVICE_TOKEN = 'service-token-value-0123456789abcdef'
const WRONG_SAME_LENGTH = 'service-token-value-0123456789abcdeX'

describe('bearer middleware', () => {
  let store: Store
  let clock: number
  let url: string
  let close: () => Promise<void>

  beforeEach(async () => {
    store = openStore(':memory:')
    clock = 1_000_000
    const app = express()
    app.use(
      createBearerMiddleware({
        store,
        serviceTokens: [{ name: 'ci', sha256: hashSecret(SERVICE_TOKEN) }],
        publicBaseUrl: `${BASE}/`,
        now: () => clock,
      }),
    )
    app.get('/whoami', (req, res) => {
      res.json((req as unknown as { principal: Principal }).principal)
    })
    const server = createServer(app)
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/whoami`
    close = () =>
      new Promise<void>((r) => {
        server.close(() => r())
        server.closeAllConnections()
      })
  })
  afterEach(async () => {
    await close()
  })

  const saveSession = (over: Partial<Parameters<Store['oauth']['saveSession']>[0]> = {}) => {
    store.oauth.saveSession({
      familyId: 'fam', accessHash: hashSecret('access-1'), refreshHash: hashSecret('refresh-1'), clientId: 'c', userId: '42',
      userName: 'alice', guilds: { g1: '8' }, accessExpiresAt: clock + 60_000, refreshExpiresAt: clock + 120_000, revoked: false, ...over,
    })
  }

  const get = (token?: string) => fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })

  const expectUnauthorized = async (res: Response) => {
    expect(res.status).toBe(401)
    expect(res.headers.get('www-authenticate')).toBe(`Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`)
    expect(await res.json()).toEqual({ error: 'unauthorized' })
  }

  it('accepts a live session token and sets a user principal', async () => {
    saveSession()
    const res = await get('access-1')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'user', userId: '42', userName: 'alice', guilds: { g1: '8' } })
  })

  it('rejects an expired session token', async () => {
    saveSession({ accessExpiresAt: clock })
    await expectUnauthorized(await get('access-1'))
  })

  it('rejects a revoked session token', async () => {
    saveSession({ revoked: true })
    await expectUnauthorized(await get('access-1'))
  })

  it('rejects an unknown token', async () => {
    await expectUnauthorized(await get('nope'))
  })

  it('rejects a missing header and non-bearer schemes', async () => {
    await expectUnauthorized(await get())
    await expectUnauthorized(await fetch(url, { headers: { Authorization: 'Basic abc' } }))
    await expectUnauthorized(await fetch(url, { headers: { Authorization: 'Bearer ' } }))
  })

  it('accepts a service token as a service principal', async () => {
    const res = await get(SERVICE_TOKEN)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ kind: 'service', userId: null, userName: 'ci', guilds: {} })
  })

  it('rejects a wrong service token of equal length', async () => {
    expect(WRONG_SAME_LENGTH).toHaveLength(SERVICE_TOKEN.length)
    await expectUnauthorized(await get(WRONG_SAME_LENGTH))
  })

  it('prefers an active session over service tokens and ignores case of scheme', async () => {
    saveSession()
    const res = await fetch(url, { headers: { Authorization: 'bearer access-1' } })
    expect(res.status).toBe(200)
  })
})
