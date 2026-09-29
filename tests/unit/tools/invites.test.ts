import { describe, expect, it } from 'vitest'
import { invitesTools } from '../../../src/tools/invites.js'
import { G, OTHER_G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(invitesTools, name)
const C = id('2')
const reason = 'via discord-mcp by tester (corr-1)'
const invite = { code: 'abc123', uses: 4, channel: { id: C } }

describe('invites', () => {
  it('invites_list', async () => {
    const ctx = makeCtx({ discord: { listInvites: async () => [invite] } })
    expect(await run(t('invites_list'), ctx, { guild_id: G })).toEqual({ items: [invite] })
  })
  it('invites_create guards channel and forwards options', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: C, guild_id: G }), createInvite: async () => invite } })
    await run(t('invites_create'), ctx, { guild_id: G, channel_id: C, max_age: 3600, max_uses: 5, temporary: true, unique: true })
    expect(ctx.calls[1]).toEqual({ method: 'createInvite', args: [C, { max_age: 3600, max_uses: 5, temporary: true, unique: true }, reason] })
  })
  it('invites_create rejects foreign channel and out-of-range values', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: C, guild_id: OTHER_G }), createInvite: async () => invite } })
    await expect(run(t('invites_create'), ctx, { guild_id: G, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
    const s = t('invites_create').input
    expect(s.safeParse({ guild_id: G, channel_id: C, max_age: 604801 }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, channel_id: C, max_uses: 101 }).success).toBe(false)
  })
  it('invites_delete preview shows uses, no mutation', async () => {
    const ctx = makeCtx({ discord: { listInvites: async () => [invite] } })
    const p = await runPreview(t('invites_delete'), ctx, { guild_id: G, code: 'abc123' })
    expect(p.summary).toContain('abc123')
    expect(p.affected).toEqual({ invites: 1 })
    expect(ctx.calls.map((c) => c.method)).toEqual(['listInvites'])
  })
  it('invites_delete handler rejects invite not in guild', async () => {
    const ctx = makeCtx({ discord: { listInvites: async () => [], deleteInvite: async () => invite } })
    await expect(run(t('invites_delete'), ctx, { guild_id: G, code: 'abc123' })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['listInvites'])
  })
  it('invites_delete handler deletes with reason', async () => {
    const ctx = makeCtx({ discord: { listInvites: async () => [invite], deleteInvite: async () => invite } })
    await run(t('invites_delete'), ctx, { guild_id: G, code: 'abc123' })
    expect(ctx.calls[1]).toEqual({ method: 'deleteInvite', args: ['abc123', reason] })
  })
})
