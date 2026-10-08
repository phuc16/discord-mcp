import { describe, expect, it } from 'vitest'
import { emojisTools } from '../../../src/tools/emojis.js'
import { G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(emojisTools, name)
const E = id('6')
const reason = 'via discord-mcp by tester (corr-1)'
const b64 = (bytes: number): string => Buffer.alloc(bytes, 1).toString('base64')
const dataUri = (bytes: number): string => `data:image/png;base64,${b64(bytes)}`

describe('emojis', () => {
  it('lists emojis and stickers', async () => {
    const ctx = makeCtx({ discord: { listEmojis: async () => [{ id: E }], listStickers: async () => [{ id: E }] } })
    expect(await run(t('emojis_list'), ctx, { guild_id: G })).toEqual({ items: [{ id: E }] })
    expect(await run(t('stickers_list'), ctx, { guild_id: G })).toEqual({ items: [{ id: E }] })
  })
  it('emojis_create forwards spec', async () => {
    const image = dataUri(100)
    const ctx = makeCtx({ discord: { createEmoji: async () => ({ id: E }) } })
    await run(t('emojis_create'), ctx, { guild_id: G, name: 'party', image })
    expect(ctx.calls[0]).toEqual({ method: 'createEmoji', args: [G, { name: 'party', image }, reason] })
  })
  it('emojis_create enforces name and 256 KB image limit', () => {
    const s = t('emojis_create').input
    expect(s.safeParse({ guild_id: G, name: 'a', image: dataUri(10) }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, name: 'a'.repeat(33), image: dataUri(10) }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, name: 'bad name', image: dataUri(10) }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, name: 'ok', image: 'not-a-data-uri' }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, name: 'ok', image: dataUri(256 * 1024) }).success).toBe(true)
    expect(s.safeParse({ guild_id: G, name: 'ok', image: dataUri(256 * 1024 + 1) }).success).toBe(false)
  })
  it('emojis_update forwards patch', async () => {
    const ctx = makeCtx({ discord: { updateEmoji: async () => ({ id: E }) } })
    await run(t('emojis_update'), ctx, { guild_id: G, emoji_id: E, name: 'renamed', roles: [id('5')] })
    expect(ctx.calls[0]).toEqual({ method: 'updateEmoji', args: [G, E, { name: 'renamed', roles: [id('5')] }, reason] })
  })
  it('emojis_delete preview names emoji, no mutation', async () => {
    const ctx = makeCtx({ discord: { listEmojis: async () => [{ id: E, name: 'party' }] } })
    const p = await runPreview(t('emojis_delete'), ctx, { guild_id: G, emoji_id: E })
    expect(p.summary).toContain('party')
    expect(ctx.calls.map((c) => c.method)).toEqual(['listEmojis'])
  })
  it('emojis_delete preview not_found for unknown emoji', async () => {
    const ctx = makeCtx({ discord: { listEmojis: async () => [] } })
    await expect(runPreview(t('emojis_delete'), ctx, { guild_id: G, emoji_id: E })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('emojis_delete handler deletes', async () => {
    const ctx = makeCtx({ discord: { deleteEmoji: async () => undefined } })
    await run(t('emojis_delete'), ctx, { guild_id: G, emoji_id: E })
    expect(ctx.calls[0]).toEqual({ method: 'deleteEmoji', args: [G, E, reason] })
  })
})

describe('stickers', () => {
  it('stickers_create forwards spec', async () => {
    const file = b64(100)
    const ctx = makeCtx({ discord: { createSticker: async () => ({ id: E }) } })
    await run(t('stickers_create'), ctx, { guild_id: G, name: 'wave', description: 'a wave', tags: 'wave', file })
    expect(ctx.calls[0]).toEqual({ method: 'createSticker', args: [G, { name: 'wave', description: 'a wave', tags: 'wave', file }, reason] })
  })
  it('stickers_create enforces 512 KB file limit and base64', () => {
    const s = t('stickers_create').input
    const base = { guild_id: G, name: 'wave', description: 'a wave', tags: 'wave' }
    expect(s.safeParse({ ...base, file: b64(512 * 1024) }).success).toBe(true)
    expect(s.safeParse({ ...base, file: b64(512 * 1024 + 3) }).success).toBe(false)
    expect(s.safeParse({ ...base, file: '***' }).success).toBe(false)
  })
  it('stickers_delete preview and handler', async () => {
    const ctx = makeCtx({ discord: { listStickers: async () => [{ id: E, name: 'wave' }], deleteSticker: async () => undefined } })
    const p = await runPreview(t('stickers_delete'), ctx, { guild_id: G, sticker_id: E })
    expect(p.summary).toContain('wave')
    expect(ctx.calls.map((c) => c.method)).toEqual(['listStickers'])
    await run(t('stickers_delete'), ctx, { guild_id: G, sticker_id: E })
    expect(ctx.calls.at(-1)).toEqual({ method: 'deleteSticker', args: [G, E, reason] })
  })
})
