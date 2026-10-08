import { describe, expect, it } from 'vitest'
import { principalFromServiceToken, principalFromSession } from '../../../src/auth/principal.js'

describe('principals', () => {
  it('builds a user principal from a session', () => {
    const p = principalFromSession({
      familyId: 'f', accessHash: 'a', refreshHash: 'r', clientId: 'c', userId: '42', userName: 'alice',
      guilds: { g: '8' }, accessExpiresAt: 1, refreshExpiresAt: 2, revoked: false,
    })
    expect(p).toEqual({ kind: 'user', userId: '42', userName: 'alice', guilds: { g: '8' } })
  })

  it('does not alias the session guild map', () => {
    const guilds = { g: '8' }
    const p = principalFromSession({
      familyId: 'f', accessHash: 'a', refreshHash: 'r', clientId: 'c', userId: '42', userName: 'alice',
      guilds, accessExpiresAt: 1, refreshExpiresAt: 2, revoked: false,
    })
    guilds.g = '0'
    expect(p.guilds.g).toBe('8')
  })

  it('builds a service principal from a token name', () => {
    expect(principalFromServiceToken('ci')).toEqual({ kind: 'service', userId: null, userName: 'ci', guilds: {} })
  })
})
