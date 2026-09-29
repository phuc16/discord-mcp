import { randomUUID } from 'node:crypto'
import { InvalidClientMetadataError } from '@modelcontextprotocol/sdk/server/auth/errors.js'
import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js'
import type { OAuthClientInformationFull } from '@modelcontextprotocol/sdk/shared/auth.js'
import type { Store } from '../store/index.js'

export const createClientsStore = (store: Store): OAuthRegisteredClientsStore => ({
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
