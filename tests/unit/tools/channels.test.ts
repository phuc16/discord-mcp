import { describe, expect, it } from 'vitest'
import { channelsTools } from '../../../src/tools/channels.js'
import { G, OTHER_G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(channelsTools, name)
const C = id('2')
const reason = 'via discord-mcp by tester (corr-1)'
const own = { id: C, guild_id: G, name: 'general', type: 0, topic: 'hi', parent_id: id('4'), nsfw: false }
const foreign = { id: C, guild_id: OTHER_G, name: 'x', type: 0 }

describe('channels read', () => {
  it('channels_list', async () => {
    const ctx = makeCtx({ discord: { listChannels: async () => [own] } })
    expect(await run(t('channels_list'), ctx, { guild_id: G })).toEqual({ items: [own] })
  })
  it('channels_get returns channel in guild', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => own } })
    expect(await run(t('channels_get'), ctx, { guild_id: G, channel_id: C })).toEqual(own)
  })
  it('channels_get rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => foreign } })
    await expect(run(t('channels_get'), ctx, { guild_id: G, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('channels_create', () => {
  it('forwards spec and reason', async () => {
    const ctx = makeCtx({ discord: { createChannel: async () => own } })
    await run(t('channels_create'), ctx, { guild_id: G, name: 'new', type: 2, topic: undefined, nsfw: true })
    expect(ctx.calls[0]).toEqual({ method: 'createChannel', args: [G, { name: 'new', type: 2, nsfw: true }, reason] })
  })
  it('validates name and type', () => {
    const s = t('channels_create').input
    expect(s.safeParse({ guild_id: G, name: '', type: 0 }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, name: 'a'.repeat(101), type: 0 }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, name: 'a', type: 3 }).success).toBe(false)
  })
})

describe('channels_update', () => {
  it('checks guild then updates', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => own, updateChannel: async () => own } })
    await run(t('channels_update'), ctx, { guild_id: G, channel_id: C, topic: 'new' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel', 'updateChannel'])
    expect(ctx.calls[1]?.args).toEqual([C, { topic: 'new' }, reason])
  })
  it('rejects foreign channel without updating', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => foreign, updateChannel: async () => own } })
    await expect(run(t('channels_update'), ctx, { guild_id: G, channel_id: C, topic: 'x' })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
})

describe('channels_move', () => {
  it('forwards positions and caps at 50', async () => {
    const ctx = makeCtx({ discord: { listChannels: async () => [own], moveChannels: async () => undefined } })
    const positions = [{ id: C, position: 1, parent_id: null }]
    await run(t('channels_move'), ctx, { guild_id: G, positions })
    expect(ctx.calls[1]).toEqual({ method: 'moveChannels', args: [G, positions] })
    const many = Array.from({ length: 51 }, () => ({ id: C, position: 0 }))
    expect(t('channels_move').input.safeParse({ guild_id: G, positions: many }).success).toBe(false)
  })
})

describe('channel permissions', () => {
  it('set forwards body after guild check', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => own, setChannelPermissions: async () => undefined } })
    await run(t('channels_set_permissions'), ctx, { guild_id: G, channel_id: C, overwrite_id: id('5'), type: 0, allow: '1024', deny: '0' })
    expect(ctx.calls[1]).toEqual({
      method: 'setChannelPermissions',
      args: [C, id('5'), { type: 0, allow: '1024', deny: '0' }, reason],
    })
  })
  it('set rejects non-numeric bits', () => {
    expect(t('channels_set_permissions').input.safeParse({ guild_id: G, channel_id: C, overwrite_id: id('5'), type: 0, allow: 'x', deny: '0' }).success).toBe(false)
  })
  it('set rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => foreign } })
    await expect(run(t('channels_set_permissions'), ctx, { guild_id: G, channel_id: C, overwrite_id: id('5'), type: 0, allow: '1', deny: '0' })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('delete forwards after guild check', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => own, deleteChannelPermissions: async () => undefined } })
    await run(t('channels_delete_permissions'), ctx, { guild_id: G, channel_id: C, overwrite_id: id('5') })
    expect(ctx.calls[1]).toEqual({ method: 'deleteChannelPermissions', args: [C, id('5'), reason] })
  })
})

describe('channels_delete', () => {
  it('preview makes no mutating call', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => own } })
    const p = await runPreview(t('channels_delete'), ctx, { guild_id: G, channel_id: C })
    expect(p.affected).toEqual({ channels: 1 })
    expect(p.summary).toContain('general')
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
  it('preview rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => foreign } })
    await expect(runPreview(t('channels_delete'), ctx, { guild_id: G, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('handler verifies guild then deletes with reason', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => own, deleteChannel: async () => own } })
    await run(t('channels_delete'), ctx, { guild_id: G, channel_id: C })
    expect(ctx.calls[1]).toEqual({ method: 'deleteChannel', args: [C, reason] })
  })
  it('handler rejects foreign channel without deleting', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => foreign, deleteChannel: async () => own } })
    await expect(run(t('channels_delete'), ctx, { guild_id: G, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
})

describe('channels_clone', () => {
  it('copies type, topic, parent and overwrites', async () => {
    const src = { ...own, permission_overwrites: [{ id: id('5'), type: 0, allow: '1', deny: '2' }] }
    const ctx = makeCtx({ discord: { getChannel: async () => src, createChannel: async () => own } })
    await run(t('channels_clone'), ctx, { guild_id: G, channel_id: C, name: 'copy' })
    expect(ctx.calls[1]).toEqual({
      method: 'createChannel',
      args: [G, { name: 'copy', type: 0, topic: 'hi', parent_id: id('4'), nsfw: false, permission_overwrites: src.permission_overwrites }, reason],
    })
  })
  it('defaults name to source name', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => own, createChannel: async () => own } })
    await run(t('channels_clone'), ctx, { guild_id: G, channel_id: C })
    expect((ctx.calls[1]?.args[1] as { name: string }).name).toBe('general')
  })
  it('rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => foreign, createChannel: async () => own } })
    await expect(run(t('channels_clone'), ctx, { guild_id: G, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('channels parent_id and move references', () => {
  const P = id('4')
  const parentForeign = { getChannel: async () => ({ id: P, guild_id: OTHER_G }), createChannel: async () => own, updateChannel: async () => own, moveChannels: async () => undefined }
  it('channels_create rejects parent_id from another guild', async () => {
    const ctx = makeCtx({ discord: parentForeign })
    await expect(run(t('channels_create'), ctx, { guild_id: G, name: 'n', type: 0, parent_id: P })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
  it('channels_update rejects parent_id from another guild', async () => {
    const ctx = makeCtx({
      discord: { ...parentForeign, getChannel: async (cid) => (cid === C ? own : { id: P, guild_id: OTHER_G }) },
    })
    await expect(run(t('channels_update'), ctx, { guild_id: G, channel_id: C, parent_id: P })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).not.toContain('updateChannel')
  })
  it('channels_update allows clearing parent_id', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => own, updateChannel: async () => own } })
    await run(t('channels_update'), ctx, { guild_id: G, channel_id: C, parent_id: null })
    expect(ctx.calls[1]?.args[1]).toEqual({ parent_id: null })
  })
  it('channels_move rejects ids and parents outside the guild', async () => {
    const ctx = makeCtx({ discord: { listChannels: async () => [own], moveChannels: async () => undefined } })
    await expect(run(t('channels_move'), ctx, { guild_id: G, positions: [{ id: id('8'), position: 1 }] })).rejects.toMatchObject({ code: 'not_found' })
    await expect(run(t('channels_move'), ctx, { guild_id: G, positions: [{ id: C, position: 1, parent_id: id('8') }] })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).not.toContain('moveChannels')
  })
})
