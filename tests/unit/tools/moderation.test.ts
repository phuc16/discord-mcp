import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { moderationTools } from '../../../src/tools/moderation.js'
import { G, OTHER_G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(moderationTools, name)
const U = id('4')
const base = 'via discord-mcp by tester (corr-1)'
const member = { id: U, nick: 'bob', user: { username: 'bobby' } }

describe('timeouts', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('mod_timeout computes ISO expiry', async () => {
    const ctx = makeCtx({ discord: { updateMember: async () => member } })
    await run(t('mod_timeout'), ctx, { guild_id: G, user_id: U, duration_seconds: 3600 })
    expect(ctx.calls[0]?.args).toEqual([G, U, { communication_disabled_until: '2026-01-01T01:00:00.000Z' }, base])
  })
  it('mod_timeout bounds duration', () => {
    const s = t('mod_timeout').input
    expect(s.safeParse({ guild_id: G, user_id: U, duration_seconds: 0 }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, user_id: U, duration_seconds: 2419201 }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, user_id: U, duration_seconds: 2419200 }).success).toBe(true)
  })
  it('mod_remove_timeout clears', async () => {
    const ctx = makeCtx({ discord: { updateMember: async () => member } })
    await run(t('mod_remove_timeout'), ctx, { guild_id: G, user_id: U })
    expect(ctx.calls[0]?.args).toEqual([G, U, { communication_disabled_until: null }, base])
  })
})

describe('mod_kick', () => {
  it('preview shows display name and does not mutate', async () => {
    const ctx = makeCtx({ discord: { getMember: async () => member } })
    const p = await runPreview(t('mod_kick'), ctx, { guild_id: G, user_id: U })
    expect(p.summary).toContain('bob')
    expect(p.affected).toEqual({ members: 1 })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getMember'])
  })
  it('handler forwards custom reason', async () => {
    const ctx = makeCtx({ discord: { kickMember: async () => undefined } })
    await run(t('mod_kick'), ctx, { guild_id: G, user_id: U, reason: 'spam' })
    expect(ctx.calls[0]).toEqual({ method: 'kickMember', args: [G, U, `${base}: spam`] })
  })
})

describe('mod_ban / unban', () => {
  it('preview tolerates non-members', async () => {
    const ctx = makeCtx({ discord: { getMember: async () => { throw new Error('nope') } } })
    const p = await runPreview(t('mod_ban'), ctx, { guild_id: G, user_id: U })
    expect(p.summary).toContain(U)
    expect(p.affected).toEqual({ users: 1 })
  })
  it('handler forwards delete_message_seconds and reason', async () => {
    const ctx = makeCtx({ discord: { banMember: async () => undefined } })
    await run(t('mod_ban'), ctx, { guild_id: G, user_id: U, delete_message_seconds: 60, reason: 'raid' })
    expect(ctx.calls[0]).toEqual({ method: 'banMember', args: [G, U, { delete_message_seconds: 60 }, `${base}: raid`] })
  })
  it('handler omits delete_message_seconds when unset', async () => {
    const ctx = makeCtx({ discord: { banMember: async () => undefined } })
    await run(t('mod_ban'), ctx, { guild_id: G, user_id: U })
    expect(ctx.calls[0]?.args[2]).toEqual({})
  })
  it('bounds delete_message_seconds', () => {
    expect(t('mod_ban').input.safeParse({ guild_id: G, user_id: U, delete_message_seconds: 604801 }).success).toBe(false)
  })
  it('mod_unban', async () => {
    const ctx = makeCtx({ discord: { unbanMember: async () => undefined } })
    await run(t('mod_unban'), ctx, { guild_id: G, user_id: U })
    expect(ctx.calls[0]).toEqual({ method: 'unbanMember', args: [G, U, base] })
  })
})

describe('mod_bulk_ban', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => String(100000000000000000n + BigInt(i)))
  it('caps at 200', () => {
    const s = t('mod_bulk_ban').input
    expect(s.safeParse({ guild_id: G, user_ids: ids(200) }).success).toBe(true)
    expect(s.safeParse({ guild_id: G, user_ids: ids(201) }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, user_ids: [] }).success).toBe(false)
  })
  it('preview counts without mutating', async () => {
    const ctx = makeCtx()
    const p = await runPreview(t('mod_bulk_ban'), ctx, { guild_id: G, user_ids: ids(5) })
    expect(p.affected).toEqual({ users: 5 })
    expect(ctx.calls).toEqual([])
  })
  it('returns failed_users from port', async () => {
    const out = { banned_users: [U], failed_users: [id('8')] }
    const ctx = makeCtx({ discord: { bulkBan: async () => out } })
    expect(await run(t('mod_bulk_ban'), ctx, { guild_id: G, user_ids: [U, id('8')], reason: 'r' })).toEqual(out)
    expect(ctx.calls[0]).toEqual({ method: 'bulkBan', args: [G, [U, id('8')], {}, `${base}: r`] })
  })
})

describe('mod_list_bans', () => {
  it('forwards paging', async () => {
    const ctx = makeCtx({ discord: { listBans: async () => [{ user: { id: U } }] } })
    await run(t('mod_list_bans'), ctx, { guild_id: G, limit: 50, after: id('1') })
    expect(ctx.calls[0]).toEqual({ method: 'listBans', args: [G, { limit: 50, after: id('1') }] })
  })
  it('returns next_cursor from the last ban user id when the page is full', async () => {
    const ctx = makeCtx({ discord: { listBans: async () => [{ user: { id: id('1') } }, { user: { id: id('2') } }] } })
    const out = (await run(t('mod_list_bans'), ctx, { guild_id: G, limit: 2 })) as { next_cursor?: string }
    expect(out.next_cursor).toBe(id('2'))
  })
  it('omits next_cursor on a short page', async () => {
    const ctx = makeCtx({ discord: { listBans: async () => [{ user: { id: id('1') } }] } })
    const out = (await run(t('mod_list_bans'), ctx, { guild_id: G, limit: 2 })) as { next_cursor?: string }
    expect(out.next_cursor).toBeUndefined()
  })
  it('defaults limit and bounds it', async () => {
    const ctx = makeCtx({ discord: { listBans: async () => [] } })
    await run(t('mod_list_bans'), ctx, { guild_id: G })
    expect(ctx.calls[0]?.args[1]).toEqual({ limit: 100 })
    expect(t('mod_list_bans').input.safeParse({ guild_id: G, limit: 1001 }).success).toBe(false)
  })
})

describe('automod event/trigger cross-check', () => {
  const base2 = { guild_id: G, name: 'r', actions: [{ type: 1 }] }
  it('accepts event_type 2 only with trigger_type 6', async () => {
    const ctx = makeCtx({ discord: { createAutomodRule: async () => ({ id: id('6') }) } })
    await run(t('automod_create_rule'), ctx, { ...base2, event_type: 2, trigger_type: 6 })
    await expect(run(t('automod_create_rule'), makeCtx(), { ...base2, event_type: 2, trigger_type: 3 })).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('rejects trigger_type 6 with event_type 1', async () => {
    await expect(run(t('automod_create_rule'), makeCtx(), { ...base2, event_type: 1, trigger_type: 6 })).rejects.toMatchObject({ code: 'invalid_input' })
  })
  it('guild-checks actions metadata channel_id on create and update', async () => {
    const C = id('2')
    const discord = { getChannel: async () => ({ id: C, guild_id: OTHER_G }) }
    const actions = [{ type: 2, metadata: { channel_id: C } }]
    await expect(run(t('automod_create_rule'), makeCtx({ discord }), { ...base2, event_type: 1, trigger_type: 3, actions })).rejects.toMatchObject({ code: 'not_found' })
    await expect(run(t('automod_update_rule'), makeCtx({ discord }), { guild_id: G, rule_id: id('6'), actions })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('mod_bulk_ban dedupe', () => {
  it('de-duplicates user ids before banning and previewing', async () => {
    const ctx = makeCtx({ discord: { bulkBan: async () => ({ banned_users: [], failed_users: [] }) } })
    await run(t('mod_bulk_ban'), ctx, { guild_id: G, user_ids: [U, U, id('8')] })
    expect(ctx.calls[0]?.args[1]).toEqual([U, id('8')])
    const p = await runPreview(t('mod_bulk_ban'), makeCtx(), { guild_id: G, user_ids: [U, U] })
    expect(p.affected).toEqual({ users: 1 })
  })
})

describe('automod', () => {
  const rule = { id: id('6'), name: 'no links' }
  it('automod_list_rules', async () => {
    const ctx = makeCtx({ discord: { listAutomodRules: async () => [rule] } })
    expect(await run(t('automod_list_rules'), ctx, { guild_id: G })).toEqual({ items: [rule] })
  })
  it('automod_create_rule forwards spec', async () => {
    const ctx = makeCtx({ discord: { createAutomodRule: async () => rule } })
    const actions = [{ type: 1 }]
    await run(t('automod_create_rule'), ctx, { guild_id: G, name: 'r', event_type: 1, trigger_type: 3, actions, enabled: true })
    expect(ctx.calls[0]).toEqual({
      method: 'createAutomodRule',
      args: [G, { name: 'r', event_type: 1, trigger_type: 3, actions, enabled: true }, base],
    })
  })
  it('automod_create_rule rejects bad trigger_type and empty actions', () => {
    const s = t('automod_create_rule').input
    expect(s.safeParse({ guild_id: G, name: 'r', event_type: 1, trigger_type: 2, actions: [{ type: 1 }] }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, name: 'r', event_type: 1, trigger_type: 3, actions: [] }).success).toBe(false)
  })
  it('automod_update_rule forwards patch', async () => {
    const ctx = makeCtx({ discord: { updateAutomodRule: async () => rule } })
    await run(t('automod_update_rule'), ctx, { guild_id: G, rule_id: rule.id, enabled: false })
    expect(ctx.calls[0]).toEqual({ method: 'updateAutomodRule', args: [G, rule.id, { enabled: false }, base] })
  })
  it('automod_delete_rule preview names rule without mutating', async () => {
    const ctx = makeCtx({ discord: { listAutomodRules: async () => [rule] } })
    const p = await runPreview(t('automod_delete_rule'), ctx, { guild_id: G, rule_id: rule.id })
    expect(p.summary).toContain('no links')
    expect(ctx.calls.map((c) => c.method)).toEqual(['listAutomodRules'])
  })
  it('automod_delete_rule preview not_found for unknown rule', async () => {
    const ctx = makeCtx({ discord: { listAutomodRules: async () => [] } })
    await expect(runPreview(t('automod_delete_rule'), ctx, { guild_id: G, rule_id: rule.id })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('automod_delete_rule handler deletes', async () => {
    const ctx = makeCtx({ discord: { deleteAutomodRule: async () => undefined } })
    await run(t('automod_delete_rule'), ctx, { guild_id: G, rule_id: rule.id })
    expect(ctx.calls[0]).toEqual({ method: 'deleteAutomodRule', args: [G, rule.id, base] })
  })
})

describe('automod channel references', () => {
  const C = id('2')
  const foreign = { getChannel: async () => ({ id: C, guild_id: OTHER_G }), createAutomodRule: async () => ({ id: C }), updateAutomodRule: async () => ({ id: C }) }
  it('automod_create_rule rejects exempt_channels outside the guild', async () => {
    const ctx = makeCtx({ discord: foreign })
    await expect(run(t('automod_create_rule'), ctx, { guild_id: G, name: 'r', event_type: 1, trigger_type: 3, actions: [{ type: 1 }], exempt_channels: [C] })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
  it('automod_update_rule rejects exempt_channels outside the guild', async () => {
    const ctx = makeCtx({ discord: foreign })
    await expect(run(t('automod_update_rule'), ctx, { guild_id: G, rule_id: id('6'), exempt_channels: [C] })).rejects.toMatchObject({ code: 'not_found' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })
})
