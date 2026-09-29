import { afterEach, describe, expect, it } from 'vitest'
import type { EventType } from '../../src/contracts/index.js'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B, call, principals } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const USER = '500000000000000001'
const OTHER_USER = '500000000000000002'

const setup = async () => {
  const harness = await buildHarness({
    config: { guilds: { [GUILD_A]: { max_tier: 'destructive' }, [GUILD_B]: { max_tier: 'destructive' } } },
  })
  h = harness
  harness.discord.seedGuild(GUILD_A, { members: 0 })
  harness.discord.seedGuild(GUILD_B)
  const role = await harness.discord.createRole(GUILD_A, { name: 'newcomer' })
  harness.discord.members.get(GUILD_A)!.set(USER, { id: USER, user: { id: USER, username: 'u' }, roles: [] })
  harness.discord.members.get(GUILD_A)!.set(OTHER_USER, { id: OTHER_USER, user: { id: OTHER_USER, username: 'o' }, roles: [] })
  harness.discord.calls.length = 0
  return { harness, role }
}

const emit = async (harness: Harness, type: EventType, data: Record<string, unknown>, guildId = GUILD_A) => {
  harness.gateway.emit({ guildId, type, at: new Date(harness.clock.now()).toISOString(), data })
  await harness.rules.idle()
}

const assignRule = (roleId: string, extra: Record<string, unknown> = {}) => ({
  guild_id: GUILD_A,
  trigger: { event: 'member_join', filter: {} },
  actions: [{ tool: 'roles_assign', input_template: { user_id: '{{event.data.user_id}}', role_id: roleId } }],
  ...extra,
})

const methods = (harness: Harness, name: string) => harness.discord.calls.filter((c) => c.method === name)

describe('rules through the MCP surface', () => {
  it('rules_create then member_join executes roles_assign', async () => {
    const { harness, role } = await setup()
    const created = await call(harness.client, 'rules_create', assignRule(role.id))
    expect(created.isError).toBe(false)
    await emit(harness, 'member_join', { user_id: USER })
    const assigned = methods(harness, 'addMemberRole')
    expect(assigned).toHaveLength(1)
    expect(assigned[0]!.args.slice(0, 3)).toEqual([GUILD_A, USER, role.id])
    expect(harness.discord.members.get(GUILD_A)!.get(USER)!.roles).toContain(role.id)
  })

  it('does not fire for other guilds, other event types, or disabled rules', async () => {
    const { harness, role } = await setup()
    const created = await call(harness.client, 'rules_create', assignRule(role.id))
    const id = created.body.id as string
    await emit(harness, 'member_remove', { user_id: USER })
    await emit(harness, 'member_join', { user_id: USER }, GUILD_B)
    expect(methods(harness, 'addMemberRole')).toHaveLength(0)
    await call(harness.client, 'rules_update', { guild_id: GUILD_A, rule_id: id, enabled: false })
    await emit(harness, 'member_join', { user_id: USER })
    expect(methods(harness, 'addMemberRole')).toHaveLength(0)
  })

  it('honours trigger filter and message_contains conditions', async () => {
    const { harness } = await setup()
    const ch = (await harness.discord.createChannel(GUILD_A, { name: 'c', type: 0 })).id
    await call(harness.client, 'rules_create', {
      guild_id: GUILD_A,
      trigger: { event: 'message_create', filter: { channel_id: ch } },
      conditions: [{ op: 'message_contains', text: 'spam' }],
      actions: [{ tool: 'messages_delete', input_template: { channel_id: ch, message_id: '{{event.data.message_id}}' } }],
      allow_destructive: true,
    })
    const m1 = await harness.discord.sendMessage(ch, { content: 'hello spam' })
    const m2 = await harness.discord.sendMessage(ch, { content: 'hello friend' })
    harness.discord.calls.length = 0
    await emit(harness, 'message_create', { channel_id: ch, message_id: m2.id, content: 'hello friend' })
    expect(methods(harness, 'deleteMessage')).toHaveLength(0)
    await emit(harness, 'message_create', { channel_id: '999999999999999999', message_id: m1.id, content: 'spam' })
    expect(methods(harness, 'deleteMessage')).toHaveLength(0)
    await emit(harness, 'message_create', { channel_id: ch, message_id: m1.id, content: 'hello spam' })
    expect(methods(harness, 'deleteMessage')).toHaveLength(1)
  })

  it('cooldown suppresses the second trigger until it elapses', async () => {
    const { harness, role } = await setup()
    await call(harness.client, 'rules_create', assignRule(role.id, { cooldown_sec: 60 }))
    await emit(harness, 'member_join', { user_id: USER })
    await emit(harness, 'member_join', { user_id: OTHER_USER })
    expect(methods(harness, 'addMemberRole')).toHaveLength(1)
    harness.clock.advance(61_000)
    await emit(harness, 'member_join', { user_id: OTHER_USER })
    expect(methods(harness, 'addMemberRole')).toHaveLength(2)
  })

  it('loop guard: a channel_create rule that creates a channel fires once', async () => {
    const { harness } = await setup()
    await call(harness.client, 'rules_create', {
      guild_id: GUILD_A,
      trigger: { event: 'channel_create', filter: {} },
      actions: [{ tool: 'channels_create', input_template: { name: 'mirror', type: 0 } }],
    })
    const seed = await harness.discord.createChannel(GUILD_A, { name: 'seed', type: 0 })
    harness.discord.calls.length = 0
    await emit(harness, 'channel_create', { channel_id: seed.id })
    const created = methods(harness, 'createChannel')
    expect(created).toHaveLength(1)
    const mirror = [...harness.discord.channels.values()].find((c) => c.name === 'mirror')!
    await emit(harness, 'channel_create', { channel_id: mirror.id })
    await emit(harness, 'channel_create', { channel_id: mirror.id })
    expect(methods(harness, 'createChannel')).toHaveLength(1)
    const unrelated = await harness.discord.createChannel(GUILD_A, { name: 'other', type: 0 })
    await emit(harness, 'channel_create', { channel_id: unrelated.id })
    expect(methods(harness, 'createChannel').filter((c) => (c.args[1] as { name: string }).name === 'mirror')).toHaveLength(2)
  })

  it('rejects a destructive action without allow_destructive at creation', async () => {
    const { harness } = await setup()
    const ch = (await harness.discord.createChannel(GUILD_A, { name: 'c', type: 0 })).id
    const r = await call(harness.client, 'rules_create', {
      guild_id: GUILD_A,
      trigger: { event: 'member_ban', filter: {} },
      actions: [{ tool: 'channels_delete', input_template: { channel_id: ch } }],
    })
    expect(r.isError).toBe(true)
    expect(r.code).toBe('invalid_input')
    expect((await call(harness.client, 'rules_list', { guild_id: GUILD_A })).body.items).toEqual([])
  })

  it('runs an allowed destructive action without a confirm token and audits it', async () => {
    const { harness } = await setup()
    const ch = (await harness.discord.createChannel(GUILD_A, { name: 'c', type: 0 })).id
    const created = await call(harness.client, 'rules_create', {
      guild_id: GUILD_A,
      trigger: { event: 'member_ban', filter: {} },
      actions: [{ tool: 'channels_delete', input_template: { channel_id: ch } }],
      allow_destructive: true,
    })
    expect(created.isError).toBe(false)
    await emit(harness, 'member_ban', { user_id: USER })
    expect(harness.discord.channels.has(ch)).toBe(false)
    const rows = harness.store.audit.query({ tool: 'channels_delete', limit: 10 })
    expect(rows.map((r) => r.outcome)).toEqual(['ok'])
    expect(rows[0]!.actor).toMatch(/^rule:/)
  })

  it('an action templated to another guild is denied and never reaches Discord', async () => {
    const { harness } = await setup()
    await call(harness.client, 'rules_create', {
      guild_id: GUILD_A,
      trigger: { event: 'member_join', filter: {} },
      actions: [{ tool: 'channels_create', input_template: { guild_id: GUILD_B, name: 'pwn', type: 0 } }],
    })
    harness.discord.calls.length = 0
    await emit(harness, 'member_join', { user_id: USER })
    expect(methods(harness, 'createChannel')).toHaveLength(0)
    expect([...harness.discord.channels.values()].some((c) => c.name === 'pwn')).toBe(false)
  })

  it('template referencing anything but event.* is rejected at creation', async () => {
    const { harness, role } = await setup()
    const r = await call(harness.client, 'rules_create', {
      ...assignRule(role.id),
      actions: [{ tool: 'roles_assign', input_template: { user_id: '{{principal.userId}}', role_id: role.id } }],
    })
    expect(r.code).toBe('invalid_input')
  })

  it('rules_test performs no Discord calls', async () => {
    const { harness, role } = await setup()
    const created = await call(harness.client, 'rules_create', assignRule(role.id))
    harness.discord.calls.length = 0
    const r = await call(harness.client, 'rules_test', {
      guild_id: GUILD_A,
      rule_id: created.body.id,
      sample_event: { id: 1, guildId: GUILD_A, type: 'member_join', at: new Date(harness.clock.now()).toISOString(), data: { user_id: USER } },
    })
    expect(r.isError).toBe(false)
    expect(r.body.matched).toBe(true)
    expect((r.body.actions as { outcome: string }[])[0]!.outcome).toBe('would_run')
    expect(harness.discord.calls).toEqual([])
    const nonMatching = await call(harness.client, 'rules_test', {
      guild_id: GUILD_A,
      rule_id: created.body.id,
      sample_event: { id: 1, guildId: GUILD_A, type: 'member_remove', at: new Date(harness.clock.now()).toISOString(), data: {} },
    })
    expect(nonMatching.body.matched).toBe(false)
    expect(harness.discord.calls).toEqual([])
  })

  it('rules cannot be reached through a different guild id', async () => {
    const { harness, role } = await setup()
    const created = await call(harness.client, 'rules_create', assignRule(role.id))
    const viaB = await call(harness.client, 'rules_update', { guild_id: GUILD_B, rule_id: created.body.id, enabled: false })
    expect(viaB.code).toBe('not_found')
    const del = await call(harness.client, 'rules_delete', { guild_id: GUILD_B, rule_id: created.body.id })
    expect(del.code).toBe('not_found')
    expect((await call(harness.client, 'rules_list', { guild_id: GUILD_A })).body.items).toHaveLength(1)
  })

  it('a user cannot modify a rule owned by another user', async () => {
    const { harness, role } = await setup()
    const alice = await harness.asPrincipal({ ...principals.admin, userId: '61', userName: 'alice', guilds: { [GUILD_A]: '8' } })
    const bob = await harness.asPrincipal({ ...principals.admin, userId: '62', userName: 'bob', guilds: { [GUILD_A]: '8' } })
    const created = await call(alice, 'rules_create', assignRule(role.id))
    expect(created.isError).toBe(false)
    const r = await call(bob, 'rules_update', { guild_id: GUILD_A, rule_id: created.body.id, enabled: false })
    expect(r.code).toBe('unauthorized')
    expect((await call(bob, 'rules_delete', { guild_id: GUILD_A, rule_id: created.body.id })).code).toBe('unauthorized')
  })

  it('a user cannot create a rule beyond their own tier', async () => {
    const { harness, role } = await setup()
    const readOnly = await harness.asPrincipal({ kind: 'user', userId: '63', userName: 'ro', guilds: { [GUILD_A]: '0' } })
    const r = await call(readOnly, 'rules_create', assignRule(role.id))
    expect(r.code).toBe('tier_exceeded')
  })

  it('caps rule actions per guild per minute', async () => {
    const { harness, role } = await setup()
    await call(harness.client, 'rules_create', assignRule(role.id))
    for (let i = 0; i < 40; i++) await emit(harness, 'member_join', { user_id: USER })
    const fired = methods(harness, 'addMemberRole').length
    expect(fired).toBeGreaterThan(0)
    expect(fired).toBeLessThanOrEqual(30)
    harness.clock.advance(61_000)
    const before = methods(harness, 'addMemberRole').length
    await emit(harness, 'member_join', { user_id: USER })
    expect(methods(harness, 'addMemberRole').length).toBe(before + 1)
  })

  it('a catastrophic regex condition neither hangs nor fires', async () => {
    const { harness, role } = await setup()
    await call(harness.client, 'rules_create', {
      ...assignRule(role.id),
      conditions: [{ op: 'matches', field: 'name', pattern: '(a+)+$' }],
    })
    const started = performance.now()
    await emit(harness, 'member_join', { user_id: USER, name: `${'a'.repeat(40)}!` })
    expect(performance.now() - started).toBeLessThan(1000)
    expect(methods(harness, 'addMemberRole')).toHaveLength(0)
  })

  it('an unknown action tool is rejected at creation', async () => {
    const { harness } = await setup()
    const r = await call(harness.client, 'rules_create', {
      guild_id: GUILD_A,
      trigger: { event: 'member_join', filter: {} },
      actions: [{ tool: 'does_not_exist', input_template: {} }],
    })
    expect(r.code).toBe('invalid_input')
  })
})
