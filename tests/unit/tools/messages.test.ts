import { describe, expect, it } from 'vitest'
import type { Dto } from '../../../src/contracts/index.js'
import { messagesTools } from '../../../src/tools/messages.js'
import { G, OTHER_G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(messagesTools, name)
const C = id('2')
const M = id('3')
const U = id('4')
const reason = 'via discord-mcp by tester (corr-1)'
const own = { id: C, guild_id: G }
const inGuild = { getChannel: async () => own }
const foreign = { getChannel: async () => ({ id: C, guild_id: OTHER_G }) }

const epoch = 1420070400000n
const recentId = (offset: number): string => String(((BigInt(Date.now()) - epoch) << 22n) - BigInt(offset))
const oldId = (): string => String(((BigInt(Date.now() - 20 * 86400000) - epoch) << 22n))

const makeChannelMessages = (n: number, author = (i: number) => (i % 2 === 0 ? U : id('8'))): Dto[] =>
  Array.from({ length: n }, (_, i) => ({ id: recentId(i + 1), content: `msg ${i}`, author: { id: author(i), username: 'u' } }))

const pagedList = (all: Dto[]) => async (_c: string, q: { limit: number; before?: string }): Promise<Dto[]> => {
  const start = q.before ? all.findIndex((m) => m.id === q.before) + 1 : 0
  return all.slice(start, start + q.limit)
}

describe('guild binding', () => {
  it.each([
    ['messages_list', {}],
    ['messages_get', { message_id: M }],
    ['messages_send', { content: 'hi' }],
    ['messages_edit', { message_id: M, content: 'x' }],
    ['messages_delete', { message_id: M }],
    ['messages_purge', { limit: 5 }],
    ['messages_pin', { message_id: M }],
    ['messages_unpin', { message_id: M }],
    ['messages_list_pins', {}],
    ['messages_crosspost', { message_id: M }],
    ['reactions_add', { message_id: M, emoji: '👍' }],
    ['reactions_remove', { message_id: M, emoji: '👍' }],
    ['reactions_clear', { message_id: M }],
    ['messages_search', { query: 'a' }],
  ])('%s rejects a channel from another guild', async (name, extra) => {
    const ctx = makeCtx({ discord: foreign })
    await expect(run(t(name), ctx, { guild_id: G, channel_id: C, ...extra })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
  it.each(['messages_delete', 'messages_purge', 'reactions_clear'])('%s preview rejects foreign channel', async (name) => {
    const ctx = makeCtx({ discord: foreign })
    const extra = name === 'messages_purge' ? { limit: 5 } : { message_id: M }
    await expect(runPreview(t(name), ctx, { guild_id: G, channel_id: C, ...extra })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('reads', () => {
  it('messages_list forwards query', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, listMessages: async () => [{ id: M }] } })
    expect(await run(t('messages_list'), ctx, { guild_id: G, channel_id: C, limit: 10, before: id('9') })).toEqual({ items: [{ id: M }] })
    expect(ctx.calls[1]).toEqual({ method: 'listMessages', args: [C, { limit: 10, before: id('9') }] })
  })
  it('messages_list rejects limit 101', () => {
    expect(t('messages_list').input.safeParse({ guild_id: G, channel_id: C, limit: 101 }).success).toBe(false)
  })
  it('messages_get', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, getMessage: async () => ({ id: M }) } })
    expect(await run(t('messages_get'), ctx, { guild_id: G, channel_id: C, message_id: M })).toEqual({ id: M })
  })
  it('messages_list_pins', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, listPins: async () => [{ id: M }] } })
    expect(await run(t('messages_list_pins'), ctx, { guild_id: G, channel_id: C })).toEqual({ items: [{ id: M }] })
  })
})

describe('messages_send', () => {
  it('defaults allowed_mentions to no pings', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, sendMessage: async () => ({ id: M }) } })
    await run(t('messages_send'), ctx, { guild_id: G, channel_id: C, content: 'hi @everyone' })
    expect(ctx.calls[1]).toEqual({ method: 'sendMessage', args: [C, { content: 'hi @everyone', allowed_mentions: { parse: [] } }] })
  })
  it('honours explicit allowed_mentions and reply_to', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, sendMessage: async () => ({ id: M }) } })
    await run(t('messages_send'), ctx, { guild_id: G, channel_id: C, content: 'x', reply_to: M, allowed_mentions: { parse: ['users'] } })
    expect(ctx.calls[1]?.args[1]).toEqual({ content: 'x', message_reference: { message_id: M }, allowed_mentions: { parse: ['users'] } })
  })
  it('requires content or embeds', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, sendMessage: async () => ({ id: M }) } })
    await expect(run(t('messages_send'), ctx, { guild_id: G, channel_id: C })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(ctx.calls.map((c) => c.method)).not.toContain('sendMessage')
  })
  it('accepts embeds only and enforces limits', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, sendMessage: async () => ({ id: M }) } })
    await run(t('messages_send'), ctx, { guild_id: G, channel_id: C, embeds: [{ title: 'a' }] })
    expect(ctx.calls[1]?.args[1]).toMatchObject({ embeds: [{ title: 'a' }] })
    const s = t('messages_send').input
    expect(s.safeParse({ guild_id: G, channel_id: C, content: 'a'.repeat(2001) }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, channel_id: C, embeds: Array.from({ length: 11 }, () => ({})) }).success).toBe(false)
  })
})

describe('mentions', () => {
  it('rejects everyone in allowed_mentions.parse', () => {
    expect(() => t('messages_send').input.parse({ guild_id: G, channel_id: C, content: 'x', allowed_mentions: { parse: ['everyone'] } })).toThrow()
  })
})

describe('messages_edit', () => {
  it('forwards content and embeds', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, editMessage: async () => ({ id: M }) } })
    await run(t('messages_edit'), ctx, { guild_id: G, channel_id: C, message_id: M, content: 'new' })
    expect(ctx.calls[1]).toEqual({ method: 'editMessage', args: [C, M, { content: 'new', allowed_mentions: { parse: [] } }] })
  })
})

describe('messages_delete', () => {
  const msg = { id: M, content: 'x'.repeat(150), author: { id: U, username: 'bob' } }
  it('preview shows author and first 100 chars, no mutation', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, getMessage: async () => msg } })
    const p = await runPreview(t('messages_delete'), ctx, { guild_id: G, channel_id: C, message_id: M })
    expect(p.summary).toContain('bob')
    expect(p.summary).toContain('x'.repeat(100))
    expect(p.summary).not.toContain('x'.repeat(101))
    expect(p.affected).toEqual({ messages: 1 })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel', 'getMessage'])
  })
  it('handler deletes with reason', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, deleteMessage: async () => undefined } })
    await run(t('messages_delete'), ctx, { guild_id: G, channel_id: C, message_id: M })
    expect(ctx.calls[1]).toEqual({ method: 'deleteMessage', args: [C, M, reason] })
  })
})

describe('messages_purge', () => {
  it('rejects limit 1001 and 0', () => {
    const s = t('messages_purge').input
    expect(s.safeParse({ guild_id: G, channel_id: C, limit: 1001 }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, channel_id: C, limit: 0 }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, channel_id: C, limit: 1000 }).success).toBe(true)
  })
  it('preview scans across pages and reports count without mutating', async () => {
    const all = makeChannelMessages(250)
    const ctx = makeCtx({ discord: { ...inGuild, listMessages: pagedList(all) } })
    const p = await runPreview(t('messages_purge'), ctx, { guild_id: G, channel_id: C, limit: 220 })
    expect(p.affected).toEqual({ messages: 220 })
    const methods = new Set(ctx.calls.map((c) => c.method))
    expect(methods).toEqual(new Set(['getChannel', 'listMessages']))
  })
  it('handler deletes exactly the previewed set in chunks of up to 100', async () => {
    const all = makeChannelMessages(250)
    const deleted: string[][] = []
    const ctx = makeCtx({
      discord: {
        ...inGuild,
        listMessages: pagedList(all),
        bulkDeleteMessages: async (_c, ids) => {
          deleted.push(ids)
        },
      },
    })
    const out = await run(t('messages_purge'), ctx, { guild_id: G, channel_id: C, limit: 220 })
    expect(out).toEqual({ deleted: 220, skipped_old: 0 })
    expect(deleted.map((d) => d.length)).toEqual([100, 100, 20])
    expect(deleted.flat()).toEqual(all.slice(0, 220).map((m) => m.id))
  })
  it('filters by user_id and contains', async () => {
    const all = makeChannelMessages(40)
    const ctx = makeCtx({ discord: { ...inGuild, listMessages: pagedList(all) } })
    const byUser = await runPreview(t('messages_purge'), ctx, { guild_id: G, channel_id: C, limit: 1000, user_id: U })
    expect(byUser.affected).toEqual({ messages: 20 })
    const byText = await runPreview(t('messages_purge'), ctx, { guild_id: G, channel_id: C, limit: 1000, contains: 'MSG 1' })
    expect(byText.affected).toEqual({ messages: 11 })
  })
  it('skips messages older than 14 days', async () => {
    const all: Dto[] = [...makeChannelMessages(3), { id: oldId(), content: 'old', author: { id: U } }]
    const calls: string[][] = []
    const ctx = makeCtx({ discord: { ...inGuild, listMessages: pagedList(all), bulkDeleteMessages: async (_c, ids) => { calls.push(ids) } } })
    const p = await runPreview(t('messages_purge'), ctx, { guild_id: G, channel_id: C, limit: 10 })
    expect(p.affected).toEqual({ messages: 3 })
    expect(p.details).toMatchObject({ skipped_old: 1 })
    expect(await run(t('messages_purge'), ctx, { guild_id: G, channel_id: C, limit: 10 })).toEqual({ deleted: 3, skipped_old: 1 })
    expect(calls).toEqual([all.slice(0, 3).map((m) => m.id)])
  })
  it('uses single delete for a lone message', async () => {
    const all = makeChannelMessages(1)
    const ctx = makeCtx({ discord: { ...inGuild, listMessages: pagedList(all), deleteMessage: async () => undefined } })
    expect(await run(t('messages_purge'), ctx, { guild_id: G, channel_id: C, limit: 5 })).toEqual({ deleted: 1, skipped_old: 0 })
    expect(ctx.calls.at(-1)?.method).toBe('deleteMessage')
  })
})

describe('pins and crosspost', () => {
  it('pin and unpin forward reason', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, pinMessage: async () => undefined, unpinMessage: async () => undefined } })
    await run(t('messages_pin'), ctx, { guild_id: G, channel_id: C, message_id: M })
    await run(t('messages_unpin'), ctx, { guild_id: G, channel_id: C, message_id: M })
    expect(ctx.calls.filter((c) => c.method !== 'getChannel')).toEqual([
      { method: 'pinMessage', args: [C, M, reason] },
      { method: 'unpinMessage', args: [C, M, reason] },
    ])
  })
  it('crosspost', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, crosspostMessage: async () => ({ id: M }) } })
    await run(t('messages_crosspost'), ctx, { guild_id: G, channel_id: C, message_id: M })
    expect(ctx.calls[1]).toEqual({ method: 'crosspostMessage', args: [C, M] })
  })
})

describe('reactions', () => {
  it('add passes emoji through', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, addReaction: async () => undefined } })
    await run(t('reactions_add'), ctx, { guild_id: G, channel_id: C, message_id: M, emoji: 'party:123456789012345678' })
    expect(ctx.calls[1]).toEqual({ method: 'addReaction', args: [C, M, 'party:123456789012345678'] })
  })
  it('remove with and without user', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, removeReaction: async () => undefined } })
    await run(t('reactions_remove'), ctx, { guild_id: G, channel_id: C, message_id: M, emoji: '👍' })
    await run(t('reactions_remove'), ctx, { guild_id: G, channel_id: C, message_id: M, emoji: '👍', user_id: U })
    expect(ctx.calls[1]?.args).toEqual([C, M, '👍'])
    expect(ctx.calls[3]?.args).toEqual([C, M, '👍', U])
  })
  it('clear preview counts reactions without mutating', async () => {
    const msg = { id: M, reactions: [{ count: 3 }, { count: 2 }] }
    const ctx = makeCtx({ discord: { ...inGuild, getMessage: async () => msg } })
    const p = await runPreview(t('reactions_clear'), ctx, { guild_id: G, channel_id: C, message_id: M })
    expect(p.affected).toEqual({ reactions: 5 })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel', 'getMessage'])
  })
  it('clear handler clears', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, clearReactions: async () => undefined } })
    await run(t('reactions_clear'), ctx, { guild_id: G, channel_id: C, message_id: M })
    expect(ctx.calls[1]).toEqual({ method: 'clearReactions', args: [C, M] })
  })
})

describe('messages_search', () => {
  it('filters client-side and reports scanned', async () => {
    const all = makeChannelMessages(150)
    const ctx = makeCtx({ discord: { ...inGuild, listMessages: pagedList(all) } })
    const out = (await run(t('messages_search'), ctx, { guild_id: G, channel_id: C, query: 'MSG 14', author_id: U })) as { items: Dto[]; scanned: number }
    expect(out.scanned).toBe(150)
    expect(out.items.map((m) => m.content)).toEqual(['msg 14', 'msg 140', 'msg 142', 'msg 144', 'msg 146', 'msg 148'])
  })
  it('respects max_scan and bounds it', async () => {
    const all = makeChannelMessages(300)
    const ctx = makeCtx({ discord: { ...inGuild, listMessages: pagedList(all) } })
    const out = (await run(t('messages_search'), ctx, { guild_id: G, channel_id: C, query: 'msg', max_scan: 120 })) as { scanned: number }
    expect(out.scanned).toBe(120)
    expect(t('messages_search').input.safeParse({ guild_id: G, channel_id: C, query: 'a', max_scan: 501 }).success).toBe(false)
  })
  it('defaults max_scan to 200', async () => {
    const all = makeChannelMessages(300)
    const ctx = makeCtx({ discord: { ...inGuild, listMessages: pagedList(all) } })
    const out = (await run(t('messages_search'), ctx, { guild_id: G, channel_id: C, query: 'zzz' })) as { scanned: number }
    expect(out.scanned).toBe(200)
  })
})
