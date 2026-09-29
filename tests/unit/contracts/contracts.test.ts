import { describe, expect, it } from 'vitest'
import { ConfigSchema, EVENT_TYPES, McpToolError, canonicalJson, isTier, maxTier, minTier, tierRank } from '../../../src/contracts/index.js'

describe('tiers', () => {
  it('ranks read < write < destructive', () => {
    expect(tierRank.read).toBeLessThan(tierRank.write)
    expect(tierRank.write).toBeLessThan(tierRank.destructive)
  })
  it('min and max', () => {
    expect(minTier('read', 'destructive')).toBe('read')
    expect(maxTier('write', 'read')).toBe('write')
  })
  it('isTier guards', () => {
    expect(isTier('write')).toBe(true)
    expect(isTier('root')).toBe(false)
  })
})

describe('McpToolError', () => {
  it('carries code and details', () => {
    const e = new McpToolError('rate_limited', 'slow down', { retry_after: 3 })
    expect(e.code).toBe('rate_limited')
    expect(e.details).toEqual({ retry_after: 3 })
  })
})

describe('canonicalJson', () => {
  it('sorts keys deeply and is stable', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}')
  })
})

describe('ConfigSchema', () => {
  const valid = {
    guilds: { '123456789012345678': { max_tier: 'destructive' } },
    tools: { deny: ['guild_prune'] },
    rate_limits: { bulk_per_minute: 5 },
    events: { retention_hours: 72, max_buffer: 50000 },
    http: { host: '0.0.0.0', port: 8787, service_tokens: [{ name: 'ci', sha256: 'a'.repeat(64) }] },
  }
  it('accepts valid config and fills defaults', () => {
    const parsed = ConfigSchema.parse({ guilds: valid.guilds })
    expect(parsed.rate_limits.bulk_per_minute).toBe(5)
    expect(parsed.events.retention_hours).toBe(72)
    expect(parsed.http.port).toBe(8787)
    expect(parsed.tools.deny).toEqual([])
  })
  it('defaults new security fields', () => {
    const parsed = ConfigSchema.parse({ guilds: valid.guilds })
    expect(parsed.http).toMatchObject({ host: '127.0.0.1', trust_proxy: false, allowed_redirect_uris: [], max_clients: 1000, max_sessions_per_principal: 10 })
    expect(parsed.safety.allow_token_confirm).toBe(false)
    expect(parsed.rules).toEqual({ max_per_guild: 50, min_cooldown_sec: 1 })
    expect(ConfigSchema.parse({ guilds: valid.guilds, http: { trust_proxy: 2 } }).http.trust_proxy).toBe(2)
    expect(ConfigSchema.parse({ guilds: valid.guilds, http: { trust_proxy: '10.0.0.0/8' } }).http.trust_proxy).toBe('10.0.0.0/8')
  })
  it('knows member_update', () => {
    expect(EVENT_TYPES).toContain('member_update')
  })
  it('rejects bad tier and non-snowflake guild id', () => {
    expect(() => ConfigSchema.parse({ guilds: { '123456789012345678': { max_tier: 'root' } } })).toThrow()
    expect(() => ConfigSchema.parse({ guilds: { abc: { max_tier: 'read' } } })).toThrow()
  })
  it('rejects empty guild map', () => {
    expect(() => ConfigSchema.parse({ guilds: {} })).toThrow()
  })
})
