import { describe, expect, it } from 'vitest'
import type { EffectivePolicy, Services } from '../../../src/contracts/index.js'
import { guildTools } from '../../../src/tools/guild.js'
import { G, byName, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(guildTools, name)

describe('guild_list', () => {
  const policy: EffectivePolicy = { guilds: { [G]: { maxTier: 'write', effectiveTier: 'write' } }, deniedTools: [] }
  const services = { policy: { effective: () => policy } } as unknown as Services
  it('is unscoped read and filters to policy guilds', async () => {
    const tool = t('guild_list')
    expect(tool.unscoped).toBe(true)
    expect(tool.tier).toBe('read')
    expect(tool.guildFrom({})).toBeNull()
    const ctx = makeCtx({ services, discord: { listGuilds: async () => [{ id: G }, { id: '8'.repeat(18) }] } })
    expect(await run(tool, ctx, {})).toEqual({ items: [{ id: G }] })
  })
})

describe('guild read tools', () => {
  it('guild_get calls getGuild', async () => {
    const ctx = makeCtx({ discord: { getGuild: async (g) => ({ id: g, name: 'n' }) } })
    expect(await run(t('guild_get'), ctx, { guild_id: G })).toEqual({ id: G, name: 'n' })
  })
  it('guild_get_preview calls getGuildPreview', async () => {
    const ctx = makeCtx({ discord: { getGuildPreview: async (g) => ({ id: g }) } })
    await run(t('guild_get_preview'), ctx, { guild_id: G })
    expect(ctx.calls[0]).toEqual({ method: 'getGuildPreview', args: [G] })
  })
  it('guild_get_prune_count validates days and calls port', async () => {
    const ctx = makeCtx({ discord: { getPruneCount: async () => ({ pruned: 4 }) } })
    expect(await run(t('guild_get_prune_count'), ctx, { guild_id: G, days: 7 })).toEqual({ pruned: 4 })
    expect(t('guild_get_prune_count').input.safeParse({ guild_id: G, days: 0 }).success).toBe(false)
    expect(t('guild_get_prune_count').input.safeParse({ guild_id: G, days: 31 }).success).toBe(false)
  })
  it('guild_get_widget calls getWidget', async () => {
    const ctx = makeCtx({ discord: { getWidget: async () => ({ enabled: true }) } })
    expect(await run(t('guild_get_widget'), ctx, { guild_id: G })).toEqual({ enabled: true })
  })
})

describe('guild write tools', () => {
  it('guild_update forwards patch and reason', async () => {
    const ctx = makeCtx({ discord: { updateGuild: async (g) => ({ id: g }) } })
    await run(t('guild_update'), ctx, { guild_id: G, name: 'xx', verification_level: 2 })
    expect(ctx.calls[0]).toEqual({
      method: 'updateGuild',
      args: [G, { name: 'xx', verification_level: 2 }, 'via discord-mcp by tester (corr-1)'],
    })
  })
  it('guild_update rejects bad verification_level', () => {
    expect(t('guild_update').input.safeParse({ guild_id: G, verification_level: 5 }).success).toBe(false)
  })
  it('guild_update_widget forwards patch', async () => {
    const ctx = makeCtx({ discord: { updateWidget: async () => ({}) } })
    await run(t('guild_update_widget'), ctx, { guild_id: G, enabled: true, channel_id: '2'.repeat(18) })
    expect(ctx.calls[0]).toEqual({ method: 'updateWidget', args: [G, { enabled: true, channel_id: '2'.repeat(18) }] })
  })
  it('guild tools use guild_id', () => {
    expect(t('guild_get').guildFrom({ guild_id: G })).toBe(G)
  })
})

describe('guild_prune', () => {
  const tool = () => t('guild_prune')
  it('is destructive with preview reporting affected members without mutating', async () => {
    const ctx = makeCtx({ discord: { getPruneCount: async () => ({ pruned: 12 }) } })
    const p = await runPreview(tool(), ctx, { guild_id: G, days: 7 })
    expect(p.affected).toEqual({ members: 12 })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getPruneCount'])
  })
  it('handler prunes with reason', async () => {
    const ctx = makeCtx({ discord: { pruneGuild: async () => ({ pruned: 3 }) } })
    expect(await run(tool(), ctx, { guild_id: G, days: 7 })).toEqual({ pruned: 3 })
    expect(ctx.calls[0]).toEqual({ method: 'pruneGuild', args: [G, 7, 'via discord-mcp by tester (corr-1)'] })
  })
})
