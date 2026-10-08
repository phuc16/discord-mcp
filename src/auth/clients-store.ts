import { randomUUID } from 'node:crypto'
import { InvalidClientMetadataError, TooManyRequestsError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Store } from '../store/index.js'

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])

export const redirectUriAllowed = (uri: string, allowed: readonly string[]): boolean => {
  if (allowed.length > 0) return allowed.includes(uri)
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return false
  }
  if (url.username !== '' || url.password !== '' || url.hash !== '') return false
  if (url.protocol === 'https:') return true
  return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)
}

export interface ClientsStoreOptions {
  allowedRedirectUris?: readonly string[]
  maxClients?: number
}

export const createClientsStore = (store: Store, opts: ClientsStoreOptions = {}): OAuthRegisteredClientsStore => ({
  getClient(clientId) {
    const c = store.oauth.getClient(clientId)
    if (!c) return undefined
    return {
      client_id: c.clientId,
      client_name: c.clientName,
      redirect_uris: c.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      client_id_issued_at: Math.floor(Date.parse(c.createdAt) / 1000),
    } as OAuthClientInformationFull
  },
  async registerClient(client) {
    if (client.redirect_uris.length === 0) throw new InvalidClientMetadataError('redirect_uris required')
    for (const uri of client.redirect_uris) {
      if (!redirectUriAllowed(String(uri), opts.allowedRedirectUris ?? [])) {
        throw new InvalidClientMetadataError('redirect_uri must be https or loopback http, or be listed in http.allowed_redirect_uris')
      }
    }
    if (opts.maxClients !== undefined && store.oauth.countClients() >= opts.maxClients) {
      throw new TooManyRequestsError('client registration limit reached')
    }
    const clientId = randomUUID()
    const createdAt = new Date().toISOString()
    store.oauth.saveClient({
      clientId,
      clientSecretHash: null,
      redirectUris: client.redirect_uris.map(String),
      clientName: client.client_name ?? '',
      createdAt,
    })
    return {
      ...client,
      client_id: clientId,
      client_id_issued_at: Math.floor(Date.parse(createdAt) / 1000),
      client_secret: undefined,
      client_secret_expires_at: undefined,
      token_endpoint_auth_method: 'none',
    }
  },
})
