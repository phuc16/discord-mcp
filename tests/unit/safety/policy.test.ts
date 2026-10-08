import { describe, expect, it } from 'vitest'
import type { Principal } from '../../../src/contracts/index.js'
import { PERM } from '../../../src/safety/permissions.js'
import { PolicyEngine } from '../../../src/safety/policy.js'

const G = '111111111111111111'
const H = '222222222222222222'

const engine = (deny: string[] = []) =>
  new PolicyEngine({ guilds: { [G]: { max_tier: 'write' }, [H]: { max_tier: 'destructive' } }, tools: { deny } })

const user = (guilds: Record<string, string>): Principal => ({ kind: 'user', userId: 'u', userName: 'u', guilds })
const stdio: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }
const service: Principal = { kind: 'service', userId: null, userName: 'svc', guilds: {} }

describe('PolicyEngine', () => {
  it('guildAllowed and maxTier follow config', () => {
    const p = engine()
    expect(p.guildAllowed(G)).toBe(true)
    expect(p.guildAllowed('333333333333333333')).toBe(false)
    expect(p.maxTier(G)).toBe('write')
    expect(p.maxTier('333333333333333333')).toBeNull()
  })

  it('toolDenied matches exact names only', () => {
    const p = engine(['messages_purge'])
    expect(p.toolDenied('messages_purge')).toBe(true)
    expect(p.toolDenied('messages_purge_all')).toBe(false)
    expect(p.toolDenied('messages')).toBe(false)
  })

  it('stdio and service use policy max tier', () => {
    const p = engine()
    expect(p.effectiveTier(stdio, G, 'guild')).toBe('write')
    expect(p.effectiveTier(service, H, 'guild')).toBe('destructive')
    expect(p.effectiveTier(stdio, '333333333333333333', 'guild')).toBeNull()
  })

  it('user tier is capped by policy', () => {
    const u = user({ [G]: PERM.ADMINISTRATOR.toString() })
    expect(engine().effectiveTier(u, G, 'guild')).toBe('write')
  })

  it('user tier is capped by discord permissions', () => {
    const u = user({ [H]: PERM.MANAGE_GUILD.toString() })
    expect(engine().effectiveTier(u, H, 'moderation')).toBe('write')
  })

  it('user without entry has no access', () => {
    expect(engine().effectiveTier(user({}), G, 'guild')).toBeNull()
  })

  it('user in non-allowlisted guild has no access', () => {
    const other = '333333333333333333'
    expect(engine().effectiveTier(user({ [other]: PERM.ADMINISTRATOR.toString() }), other, 'guild')).toBeNull()
  })

  it('canRead', () => {
    const p = engine()
    expect(p.canRead(stdio, G)).toBe(true)
    expect(p.canRead(stdio, '333333333333333333')).toBe(false)
    expect(p.canRead(user({ [G]: '0' }), G)).toBe(true)
    expect(p.canRead(user({}), G)).toBe(false)
  })

  it('effective lists only allowlisted guilds the principal can see', () => {
    const p = engine(['x'])
    const u = user({ [G]: PERM.MANAGE_GUILD.toString(), '333333333333333333': PERM.ADMINISTRATOR.toString() })
    expect(p.effective(u)).toEqual({
      guilds: { [G]: { maxTier: 'write', effectiveTier: 'write' } },
      deniedTools: ['x'],
    })
  })

  it('effective for stdio lists every allowlisted guild', () => {
    expect(engine().effective(stdio).guilds).toEqual({
      [G]: { maxTier: 'write', effectiveTier: 'write' },
      [H]: { maxTier: 'destructive', effectiveTier: 'destructive' },
    })
  })
})
