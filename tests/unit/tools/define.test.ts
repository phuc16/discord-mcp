import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  assertChannelInGuild,
  assertInviteInGuild,
  assertWebhookInGuild,
  auditReason,
  defineTool,
  guildId,
  snowflake,
} from '../../../src/tools/define.js'
import { allTools } from '../../../src/tools/index.js'
import { G, OTHER_G, id, makeCtx } from './helpers.js'

describe('snowflake', () => {
  it('accepts 17-20 digits only', () => {
    expect(snowflake.safeParse('1'.repeat(17)).success).toBe(true)
    expect(snowflake.safeParse('1'.repeat(20)).success).toBe(true)
    expect(snowflake.safeParse('1'.repeat(16)).success).toBe(false)
    expect(snowflake.safeParse('abc').success).toBe(false)
  })
  it('guildId is a described snowflake', () => {
    expect(guildId.description).toBe('Target guild id')
    expect(guildId.safeParse(G).success).toBe(true)
  })
})

describe('defineTool', () => {
  const base = {
    name: 'x_y',
    group: 'x',
    description: 'd',
    tier: 'read' as const,
    input: { guild_id: guildId },
    guildFrom: (i: { guild_id: string }) => i.guild_id,
    handler: async () => ({ data: 1 }),
  }
  it('wraps shape into a zod object', () => {
    const t = defineTool(base)
    expect(t.input).toBeInstanceOf(z.ZodObject)
    expect(t.input.safeParse({ guild_id: G }).success).toBe(true)
    expect(t.input.safeParse({ guild_id: 'abc' }).success).toBe(false)
  })
  it('allows unscoped read tools', () => {
    const t = defineTool({ ...base, input: {}, unscoped: true, guildFrom: () => null })
    expect(t.unscoped).toBe(true)
  })
  it('throws when an unscoped tool is not read tier', () => {
    expect(() => defineTool({ ...base, tier: 'write', input: {}, unscoped: true, guildFrom: () => null })).toThrow(/unscoped/)
  })
  it('throws when a destructive tool has no preview', () => {
    expect(() => defineTool({ ...base, tier: 'destructive' })).toThrow(/preview/)
  })
})

describe('auditReason', () => {
  it('names principal and correlation id', () => {
    expect(auditReason(makeCtx())).toBe('via discord-mcp by tester (corr-1)')
  })
})

describe('guild binding helpers', () => {
  it('assertChannelInGuild returns channel in the guild', async () => {
    const ch = { id: id('2'), guild_id: G }
    const ctx = makeCtx({ discord: { getChannel: async () => ch } })
    await expect(assertChannelInGuild(ctx, id('2'), G)).resolves.toEqual(ch)
  })
  it('assertChannelInGuild rejects channel from another guild', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: id('2'), guild_id: OTHER_G }) } })
    await expect(assertChannelInGuild(ctx, id('2'), G)).rejects.toMatchObject({ code: 'not_found' })
  })
  it('assertChannelInGuild rejects when guild_id missing (DM)', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: id('2') }) } })
    await expect(assertChannelInGuild(ctx, id('2'), G)).rejects.toMatchObject({ code: 'not_found' })
  })
  it('assertWebhookInGuild rejects other guild and accepts own', async () => {
    const bad = makeCtx({ discord: { listWebhooks: async () => [{ id: id('3'), guild_id: OTHER_G }] } })
    await expect(assertWebhookInGuild(bad, id('3'), G)).rejects.toMatchObject({ code: 'not_found' })
    const wh = { id: id('3'), guild_id: G, token: 't' }
    const good = makeCtx({ discord: { listWebhooks: async () => [wh] } })
    await expect(assertWebhookInGuild(good, id('3'), G)).resolves.toEqual(wh)
  })
  it('assertWebhookInGuild rejects unknown webhook', async () => {
    const ctx = makeCtx({ discord: { listWebhooks: async () => [] } })
    await expect(assertWebhookInGuild(ctx, id('3'), G)).rejects.toMatchObject({ code: 'not_found' })
  })
  it('assertInviteInGuild matches by invite guild id', async () => {
    const good = makeCtx({ discord: { listInvites: async () => [{ code: 'abc', guild: { id: G } }] } })
    await expect(assertInviteInGuild(good, 'abc', G)).resolves.toMatchObject({ code: 'abc' })
    const missing = makeCtx({ discord: { listInvites: async () => [{ code: 'zzz' }] } })
    await expect(assertInviteInGuild(missing, 'abc', G)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('registry', () => {
  it('allTools is an array', () => {
    expect(Array.isArray(allTools)).toBe(true)
  })
})
