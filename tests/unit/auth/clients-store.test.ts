import { beforeEach, describe, expect, it } from 'vitest'
import { createClientsStore } from '../../../src/auth/clients-store.js'
import { hashSecret, newToken } from '../../../src/auth/tokens.js'
import { openStore } from '../../../src/store/index.js'
import type { Store } from '../../../src/store/index.js'

describe('tokens', () => {
  it('newToken is 32 random bytes base64url', () => {
    expect(newToken()).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(newToken()).not.toBe(newToken())
  })
  it('hashSecret is sha256 hex', () => {
    expect(hashSecret('a')).toBe('ca978112ca1bbdcafac231b39a23dc4da786eff8147c4e72b9807785afee48bb')
  })
})

describe('clients store', () => {
  let store: Store
  beforeEach(() => {
    store = openStore(':memory:')
  })

  it('registers a public client keeping exact redirect URIs', async () => {
    const cs = createClientsStore(store)
    const reg = await cs.registerClient!({ redirect_uris: ['https://app.example/cb', 'http://127.0.0.1:9999/cb'], client_name: 'App', client_secret: 'ignored' })
    expect(reg.client_id).toBeTruthy()
    expect(reg.client_secret).toBeUndefined()
    expect(reg.token_endpoint_auth_method).toBe('none')
    const got = await cs.getClient(reg.client_id)
    expect(got?.redirect_uris.map(String)).toEqual(['https://app.example/cb', 'http://127.0.0.1:9999/cb'])
    expect(got?.client_name).toBe('App')
    expect(got?.client_secret).toBeUndefined()
  })

  it('never persists a secret', async () => {
    const cs = createClientsStore(store)
    const reg = await cs.registerClient!({ redirect_uris: ['https://a/cb'], client_secret: 'topsecret' })
    expect(store.oauth.getClient(reg.client_id)?.clientSecretHash).toBeNull()
  })

  it('unknown client is undefined', async () => {
    expect(await createClientsStore(store).getClient('nope')).toBeUndefined()
  })

  it('rejects registration without redirect uris', async () => {
    await expect(createClientsStore(store).registerClient!({ redirect_uris: [] })).rejects.toThrow()
  })
})
