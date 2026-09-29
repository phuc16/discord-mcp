import { describe, expect, it } from 'vitest'
import { threadsTools } from '../../../src/tools/threads.js'
import { G, OTHER_G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(threadsTools, name)
const C = id('2')
const T = id('3')
const U = id('4')
const reason = 'via discord-mcp by tester (corr-1)'
const own = { id: C, guild_id: G, name: 'forum', available_tags: [{ id: id('7'), name: 'bug' }] }
const foreign = { id: C, guild_id: OTHER_G }
const inGuild = { getChannel: async () => own }
const inOther = { getChannel: async () => foreign }

describe('thread listing', () => {
  it('threads_list_active', async () => {
    const ctx = makeCtx({ discord: { listActiveThreads: async () => [{ id: T }] } })
    expect(await run(t('threads_list_active'), ctx, { guild_id: G })).toEqual({ items: [{ id: T }] })
  })
  it('threads_list_archived forwards query after guild check', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, listArchivedThreads: async () => [{ id: T }] } })
    await run(t('threads_list_archived'), ctx, { guild_id: G, channel_id: C, kind: 'private', limit: 10 })
    expect(ctx.calls[1]).toEqual({ method: 'listArchivedThreads', args: [C, { kind: 'private', limit: 10 }] })
  })
  it('threads_list_archived rejects foreign channel and bad limit', async () => {
    const ctx = makeCtx({ discord: inOther })
    await expect(run(t('threads_list_archived'), ctx, { guild_id: G, channel_id: C, kind: 'public' })).rejects.toMatchObject({ code: 'not_found' })
    expect(t('threads_list_archived').input.safeParse({ guild_id: G, channel_id: C, kind: 'public', limit: 101 }).success).toBe(false)
  })
})

describe('threads_create', () => {
  it('forwards spec with reason', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, createThread: async () => ({ id: T }) } })
    await run(t('threads_create'), ctx, { guild_id: G, channel_id: C, name: 'topic', type: 12, auto_archive_duration: 1440 })
    expect(ctx.calls[1]).toEqual({ method: 'createThread', args: [C, { name: 'topic', type: 12, auto_archive_duration: 1440 }, reason] })
  })
  it('passes message_id for message threads', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, createThread: async () => ({ id: T }) } })
    await run(t('threads_create'), ctx, { guild_id: G, channel_id: C, name: 'topic', message_id: id('5') })
    expect(ctx.calls[1]?.args[1]).toEqual({ name: 'topic', message_id: id('5') })
  })
  it('rejects bad auto_archive_duration and foreign channel', async () => {
    expect(t('threads_create').input.safeParse({ guild_id: G, channel_id: C, name: 'a', auto_archive_duration: 5 }).success).toBe(false)
    const ctx = makeCtx({ discord: inOther })
    await expect(run(t('threads_create'), ctx, { guild_id: G, channel_id: C, name: 'a' })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('thread mutation', () => {
  const threadOwn = { id: T, guild_id: G, name: 'th', message_count: 7 }
  it('threads_update guards then updates', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => threadOwn, updateChannel: async () => threadOwn } })
    await run(t('threads_update'), ctx, { guild_id: G, thread_id: T, archived: true })
    expect(ctx.calls[1]).toEqual({ method: 'updateChannel', args: [T, { archived: true }, reason] })
  })
  it('threads_update rejects foreign thread', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: T, guild_id: OTHER_G }), updateChannel: async () => ({ id: T }) } })
    await expect(run(t('threads_update'), ctx, { guild_id: G, thread_id: T, locked: true })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
  it('add and remove member', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => threadOwn, addThreadMember: async () => undefined, removeThreadMember: async () => undefined } })
    await run(t('threads_add_member'), ctx, { guild_id: G, thread_id: T, user_id: U })
    await run(t('threads_remove_member'), ctx, { guild_id: G, thread_id: T, user_id: U })
    expect(ctx.calls.filter((c) => c.method !== 'getChannel')).toEqual([
      { method: 'addThreadMember', args: [T, U] },
      { method: 'removeThreadMember', args: [T, U] },
    ])
  })
  it('add member rejects foreign thread', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: T, guild_id: OTHER_G }), addThreadMember: async () => undefined } })
    await expect(run(t('threads_add_member'), ctx, { guild_id: G, thread_id: T, user_id: U })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('threads_delete preview reports message count without mutating', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => threadOwn } })
    const p = await runPreview(t('threads_delete'), ctx, { guild_id: G, thread_id: T })
    expect(p.summary).toContain('th')
    expect(p.affected).toEqual({ threads: 1, messages: 7 })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
  it('threads_delete handler deletes after guild check', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => threadOwn, deleteChannel: async () => threadOwn } })
    await run(t('threads_delete'), ctx, { guild_id: G, thread_id: T })
    expect(ctx.calls[1]).toEqual({ method: 'deleteChannel', args: [T, reason] })
  })
})

describe('forum', () => {
  it('forum_create_post builds message body', async () => {
    const ctx = makeCtx({ discord: { ...inGuild, createForumPost: async () => ({ id: T }) } })
    await run(t('forum_create_post'), ctx, { guild_id: G, channel_id: C, name: 'post', content: 'hello', applied_tags: [id('7')] })
    expect(ctx.calls[1]).toEqual({
      method: 'createForumPost',
      args: [C, { name: 'post', applied_tags: [id('7')], message: { content: 'hello', allowed_mentions: { parse: [] } } }, reason],
    })
  })
  it('forum_create_post rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: inOther })
    await expect(run(t('forum_create_post'), ctx, { guild_id: G, channel_id: C, name: 'p', content: 'c' })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('forum_list_tags returns available_tags', async () => {
    const ctx = makeCtx({ discord: inGuild })
    expect(await run(t('forum_list_tags'), ctx, { guild_id: G, channel_id: C })).toEqual({ items: own.available_tags })
  })
  it('forum_list_tags returns empty list when none', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: C, guild_id: G }) } })
    expect(await run(t('forum_list_tags'), ctx, { guild_id: G, channel_id: C })).toEqual({ items: [] })
  })
  it('forum_update_tags sets available_tags', async () => {
    const tags = [{ name: 'new', moderated: true }]
    const ctx = makeCtx({ discord: { ...inGuild, updateChannel: async () => own } })
    await run(t('forum_update_tags'), ctx, { guild_id: G, channel_id: C, tags })
    expect(ctx.calls[1]).toEqual({ method: 'updateChannel', args: [C, { available_tags: tags }, reason] })
  })
})
