import { describe, expect, it } from 'vitest'
import { membersTools } from '../../../src/tools/members.js'
import { G, OTHER_G, byName, id, makeCtx, run } from './helpers.js'

const t = (name: string) => byName(membersTools, name)
const U = id('4')
const R = id('5')
const C = id('2')
const reason = 'via discord-mcp by tester (corr-1)'
const member = { id: U, nick: 'n' }

describe('member reads', () => {
  it('members_list defaults limit 100', async () => {
    const ctx = makeCtx({ discord: { listMembers: async () => [member] } })
    expect(await run(t('members_list'), ctx, { guild_id: G })).toEqual({ items: [member], next_cursor: undefined })
    expect(ctx.calls[0]).toEqual({ method: 'listMembers', args: [G, { limit: 100 }] })
  })
  it('members_list passes after and returns cursor when page is full', async () => {
    const page = [{ id: id('1') }, { id: id('2') }]
    const ctx = makeCtx({ discord: { listMembers: async () => page } })
    const out = (await run(t('members_list'), ctx, { guild_id: G, limit: 2, after: id('9') })) as { next_cursor?: string }
    expect(ctx.calls[0]?.args[1]).toEqual({ limit: 2, after: id('9') })
    expect(out.next_cursor).toBe(id('2'))
  })
  it('members_list rejects limit 1001', () => {
    expect(t('members_list').input.safeParse({ guild_id: G, limit: 1001 }).success).toBe(false)
  })
  it('members_get', async () => {
    const ctx = makeCtx({ discord: { getMember: async () => member } })
    expect(await run(t('members_get'), ctx, { guild_id: G, user_id: U })).toEqual(member)
  })
  it('members_search validates query and limit', async () => {
    const ctx = makeCtx({ discord: { searchMembers: async () => [member] } })
    await run(t('members_search'), ctx, { guild_id: G, query: 'bob', limit: 5 })
    expect(ctx.calls[0]).toEqual({ method: 'searchMembers', args: [G, 'bob', 5] })
    expect(t('members_search').input.safeParse({ guild_id: G, query: '' }).success).toBe(false)
    expect(t('members_search').input.safeParse({ guild_id: G, query: 'a', limit: 101 }).success).toBe(false)
  })
})

describe('member writes', () => {
  it('members_update_nick sets and clears nick', async () => {
    const ctx = makeCtx({ discord: { updateMember: async () => member } })
    await run(t('members_update_nick'), ctx, { guild_id: G, user_id: U, nick: 'x' })
    await run(t('members_update_nick'), ctx, { guild_id: G, user_id: U, nick: null })
    expect(ctx.calls[0]?.args).toEqual([G, U, { nick: 'x' }, reason])
    expect(ctx.calls[1]?.args).toEqual([G, U, { nick: null }, reason])
  })
  it('members_add_role and members_remove_role', async () => {
    const ctx = makeCtx({ discord: { addMemberRole: async () => undefined, removeMemberRole: async () => undefined } })
    await run(t('members_add_role'), ctx, { guild_id: G, user_id: U, role_id: R })
    await run(t('members_remove_role'), ctx, { guild_id: G, user_id: U, role_id: R })
    expect(ctx.calls.map((c) => c.method)).toEqual(['addMemberRole', 'removeMemberRole'])
    expect(ctx.calls[0]?.args).toEqual([G, U, R, reason])
  })
  it('members_move_voice guards channel then moves', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: C, guild_id: G }), updateMember: async () => member } })
    await run(t('members_move_voice'), ctx, { guild_id: G, user_id: U, channel_id: C })
    expect(ctx.calls[1]).toEqual({ method: 'updateMember', args: [G, U, { channel_id: C }, reason] })
  })
  it('members_move_voice rejects foreign channel', async () => {
    const ctx = makeCtx({ discord: { getChannel: async () => ({ id: C, guild_id: OTHER_G }), updateMember: async () => member } })
    await expect(run(t('members_move_voice'), ctx, { guild_id: G, user_id: U, channel_id: C })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
  it('members_disconnect_voice sends null channel', async () => {
    const ctx = makeCtx({ discord: { updateMember: async () => member } })
    await run(t('members_disconnect_voice'), ctx, { guild_id: G, user_id: U })
    expect(ctx.calls[0]?.args).toEqual([G, U, { channel_id: null }, reason])
  })
})
