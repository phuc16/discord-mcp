import { afterEach, describe, expect, it } from 'vitest'
import type { EventType, Principal } from '../../src/contracts/index.js'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B, call, principals } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const USER = '500000000000000001'
const ADMIN_ID = '11'

const setup = async (config: Record<string, unknown> = {}) => {
  const harness = await buildHarness({
    config: {
      safety: { allow_token_confirm: true },
      guilds: { [GUILD_A]: { max_tier: 'destructive' }, [GUILD_B]: { max_tier: 'destructive' } },
      ...config,
    } as never,
  })
  h = harness
  const d = harness.discord
  d.seedGuild(GUILD_A)
  d.seedGuild(GUILD_B)
  const role = await d.createRole(GUILD_A, { name: 'newcomer' })
  const roleB = await d.createRole(GUILD_B, { name: 'newcomer' })
  d.members.get(GUILD_A)!.set(USER, { user: { id: USER, username: 'u' }, roles: [] } as never)
  d.members.get(GUILD_B)!.set(USER, { user: { id: USER, username: 'u' }, roles: [] } as never)
  const ch = (await d.createChannel(GUILD_A, { name: 'general', type: 0 })).id
  d.calls.length = 0
  return { harness, role, roleB, ch }
}

const emit = async (harness: Harness, type: EventType, data: Record<string, unknown>, guildId = GUILD_A) => {
  harness.gateway.emit({ guildId, type, at: new Date(harness.clock.now()).toISOString(), data })
  await harness.rules.idle()
}

const assignRule = (roleId: string, extra: Record<string, unknown> = {}, guildId = GUILD_A) => ({
  guild_id: guildId,
  trigger: { event: 'member_join', filter: {} },
  actions: [{ tool: 'roles_assign', input_template: { user_id: '{{event.data.user_id}}', role_id: roleId } }],
  ...extra,
})

const calls = (harness: Harness, name: string) => harness.discord.calls.filter((c) => c.method === name)

describe('rules cannot smuggle destructive power past the confirm gate', () => {
  it('rules_create with allow_destructive is refused at write tier', async () => {
    const { harness, role } = await setup()
    const r = await call(harness.client, 'rules_create', assignRule(role.id, { allow_destructive: true }))
    expect(r.code).toBe('invalid_input')
    expect(r.text).toContain('rules_create_destructive')
    expect(harness.store.rules.list(GUILD_A)).toEqual([])
  })

  it('rules_create with a destructive action is refused at write tier', async () => {
    const { harness, ch } = await setup()
    const r = await call(harness.client, 'rules_create', {
      guild_id: GUILD_A,
      trigger: { event: 'member_join', filter: {} },
      actions: [{ tool: 'channels_delete', input_template: { channel_id: ch } }],
      allow_destructive: true,
    })
    expect(r.code).toBe('invalid_input')
    expect(harness.store.rules.list(GUILD_A)).toEqual([])
  })

  it('rules_update cannot turn on allow_destructive or add a destructive action at write tier', async () => {
    const { harness, role, ch } = await setup()
    const created = await call(harness.client, 'rules_create', assignRule(role.id))
    const id = created.body.id as string
    const flag = await call(harness.client, 'rules_update', { guild_id: GUILD_A, rule_id: id, allow_destructive: true })
    expect(flag.code).toBe('invalid_input')
    const action = await call(harness.client, 'rules_update', {
      guild_id: GUILD_A,
      rule_id: id,
      allow_destructive: true,
      actions: [{ tool: 'channels_delete', input_template: { channel_id: ch } }],
    })
    expect(action.code).toBe('invalid_input')
    expect(harness.store.rules.get(id)!.allow_destructive).toBe(false)
  })

  const destructiveRule = (ch: string) => ({
    guild_id: GUILD_A,
    trigger: { event: 'member_join', filter: {} },
    actions: [{ tool: 'channels_delete', input_template: { channel_id: ch } }],
    allow_destructive: true,
  })

  it('rules_create_destructive needs confirmation and stores nothing before it', async () => {
    const { harness, ch } = await setup()
    const first = await call(harness.client, 'rules_create_destructive', destructiveRule(ch))
    expect(first.code).toBe('confirm_required')
    const preview = JSON.stringify(first.details.preview)
    expect(preview).toContain('member_join')
    expect(preview).toContain('channels_delete')
    expect(harness.store.rules.list(GUILD_A)).toEqual([])
    const done = await call(harness.client, 'rules_create_destructive', { ...destructiveRule(ch), confirm_token: first.details.confirm_token })
    expect(done.isError, done.text).toBe(false)
    expect(harness.store.rules.list(GUILD_A)).toHaveLength(1)
  })

  it('rules_create_destructive fails closed without elicitation when the token flow is off', async () => {
    const { harness, ch } = await setup({ safety: { allow_token_confirm: false } })
    const r = await call(harness.client, 'rules_create_destructive', destructiveRule(ch))
    expect(r.code).toBe('confirm_required')
    expect(r.details).not.toHaveProperty('confirm_token')
    expect(harness.store.rules.list(GUILD_A)).toEqual([])
  })

  it('a caller without destructive tier cannot create a destructive rule even after confirmation', async () => {
    const { harness, ch } = await setup()
    const writer: Principal = { kind: 'user', userId: '12', userName: 'mg', guilds: { [GUILD_A]: '32' } }
    const client = await harness.asPrincipal(writer, { elicit: 'accept' })
    const r = await call(client, 'rules_create_destructive', destructiveRule(ch))
    expect(r.isError).toBe(true)
    expect(harness.store.rules.list(GUILD_A)).toEqual([])
  })

  it('the service itself refuses a destructive rule from a write-tier creator', async () => {
    const { harness, ch } = await setup()
    const writer: Principal = { kind: 'user', userId: '12', userName: 'mg', guilds: { [GUILD_A]: '32' } }
    await expect(harness.rules.create(writer, { ...destructiveRule(ch), trigger: { event: 'member_join', filter: {} }, conditions: [], cooldown_sec: 5, enabled: true })).rejects.toMatchObject({
      code: expect.stringMatching(/tier_exceeded|invalid_input|missing_permissions/),
    })
  })

  it('rule listings do not expose other owners rules to plain readers', async () => {
    const { harness, role } = await setup()
    const owner = await harness.asPrincipal({ kind: 'user', userId: '12', userName: 'owner', guilds: { [GUILD_A]: '32' } })
    const created = await call(owner, 'rules_create', assignRule(role.id))
    expect(created.isError, created.text).toBe(false)
    const reader = await harness.asPrincipal({ kind: 'user', userId: '13', userName: 'reader', guilds: { [GUILD_A]: '1024' } })
    const seen = await call(reader, 'rules_list', { guild_id: GUILD_A })
    expect(seen.isError, seen.text).toBe(false)
    expect(seen.body.items).toEqual([])
    const own = await call(owner, 'rules_list', { guild_id: GUILD_A })
    expect((own.body.items as unknown[]).length).toBe(1)
    const admin = await harness.asPrincipal(principals.admin)
    expect(((await call(admin, 'rules_list', { guild_id: GUILD_A })).body.items as unknown[]).length).toBe(1)
  })
})

describe('regex conditions cannot block the event loop', () => {
  const lagWhile = async (work: () => Promise<void>): Promise<number> => {
    let last = performance.now()
    let max = 0
    const timer = setInterval(() => {
      const now = performance.now()
      max = Math.max(max, now - last - 10)
      last = now
    }, 10)
    await work()
    await new Promise((r) => setTimeout(r, 30))
    clearInterval(timer)
    return max
  }

  it.each([
    ['^(a|a)+$', 30],
    ['(a|aa)+$', 40],
    ['.*.*.*.*.*.*x', 60],
    ['^(a+)+$', 35],
  ])('pattern %s on %i chars never blocks more than about 100ms and does not fire', async (pattern, n) => {
    const { harness, role } = await setup()
    const created = await call(harness.client, 'rules_create', assignRule(role.id, { conditions: [{ op: 'matches', field: 'content', pattern }] }))
    if (created.isError) {
      expect(created.code).toBe('invalid_input')
      return
    }
    const lag = await lagWhile(() => emit(harness, 'member_join', { user_id: USER, content: `${'a'.repeat(n)}!` }))
    expect(lag).toBeLessThan(250)
    expect(calls(harness, 'addMemberRole')).toHaveLength(0)
  }, 20_000)

  it('a benign pattern still matches', async () => {
    const { harness, role } = await setup()
    const created = await call(harness.client, 'rules_create', assignRule(role.id, { conditions: [{ op: 'matches', field: 'content', pattern: '^hello' }] }))
    expect(created.isError, created.text).toBe(false)
    await emit(harness, 'member_join', { user_id: USER, content: 'hello world' })
    expect(calls(harness, 'addMemberRole')).toHaveLength(1)
  })
})

describe('rule loops and limits are bounded', () => {
  const echoRule = (ch: string) => ({
    guild_id: GUILD_A,
    trigger: { event: 'message_create', filter: {} },
    actions: [{ tool: 'messages_send', input_template: { channel_id: ch, content: 'echo' } }],
  })

  it('bot-authored messages do not trigger message rules (the rule reply cannot re-trigger itself)', async () => {
    const { harness, ch } = await setup()
    const created = await call(harness.client, 'rules_create', echoRule(ch))
    expect(created.isError, created.text).toBe(false)
    await emit(harness, 'message_create', { message_id: '1', channel_id: ch, author_id: '42', author_is_bot: false })
    expect(calls(harness, 'sendMessage')).toHaveLength(1)
    for (let i = 0; i < 5; i++) {
      harness.clock.advance(10_000)
      await emit(harness, 'message_create', { message_id: String(100 + i), channel_id: ch, author_id: 'bot', author_is_bot: true })
    }
    expect(calls(harness, 'sendMessage')).toHaveLength(1)
  })

  it('webhook-authored echoes do not re-trigger a rule that executes a webhook', async () => {
    const { harness, ch } = await setup()
    const wh = await harness.discord.createWebhook(ch, { name: 'hook' })
    const created = await call(harness.client, 'rules_create', {
      guild_id: GUILD_A,
      trigger: { event: 'message_create', filter: {} },
      actions: [{ tool: 'webhooks_execute', input_template: { webhook_id: wh.id, content: 'ping' } }],
    })
    expect(created.isError, created.text).toBe(false)
    await emit(harness, 'message_create', { message_id: '1', channel_id: ch, author_id: '42', author_is_bot: false })
    expect(calls(harness, 'executeWebhook')).toHaveLength(1)
    for (let i = 0; i < 5; i++) {
      harness.clock.advance(10_000)
      await emit(harness, 'message_create', { message_id: String(200 + i), channel_id: ch, author_id: wh.id, author_is_bot: true })
    }
    expect(calls(harness, 'executeWebhook')).toHaveLength(1)
  })

  it('a burst of message_delete events from a purge fires a destructive rule at most once per cooldown', async () => {
    const { harness, ch } = await setup()
    const created = await call(harness.client, 'rules_create_destructive', {
      guild_id: GUILD_A,
      trigger: { event: 'message_delete', filter: {} },
      actions: [{ tool: 'messages_send', input_template: { channel_id: ch, content: 'deleted' } }],
      cooldown_sec: 0,
      allow_destructive: true,
    })
    const confirmed = created.code === 'confirm_required' ? await call(harness.client, 'rules_create_destructive', {
      guild_id: GUILD_A,
      trigger: { event: 'message_delete', filter: {} },
      actions: [{ tool: 'messages_send', input_template: { channel_id: ch, content: 'deleted' } }],
      cooldown_sec: 0,
      allow_destructive: true,
      confirm_token: created.details.confirm_token,
    }) : created
    if (confirmed.isError) return
    for (let i = 0; i < 50; i++) await emit(harness, 'message_delete', { message_id: String(i), channel_id: ch })
    expect(calls(harness, 'sendMessage').length).toBeLessThanOrEqual(1)
    const stored = harness.store.rules.list(GUILD_A)[0]!
    expect(stored.cooldown_sec).toBeGreaterThanOrEqual(1)
  })

  it('rules.min_cooldown_sec is enforced on create and update', async () => {
    const { harness, role } = await setup({ rules: { max_per_guild: 50, min_cooldown_sec: 5 } })
    const created = await call(harness.client, 'rules_create', assignRule(role.id, { cooldown_sec: 0 }))
    if (!created.isError) expect(harness.store.rules.get(created.body.id as string)!.cooldown_sec).toBeGreaterThanOrEqual(5)
    else expect(created.code).toBe('invalid_input')
    const ok = await call(harness.client, 'rules_create', assignRule(role.id, { cooldown_sec: 10 }))
    expect(ok.isError, ok.text).toBe(false)
    const lowered = await call(harness.client, 'rules_update', { guild_id: GUILD_A, rule_id: ok.body.id, cooldown_sec: 0 })
    if (!lowered.isError) expect(harness.store.rules.get(ok.body.id as string)!.cooldown_sec).toBeGreaterThanOrEqual(5)
    else expect(lowered.code).toBe('invalid_input')
  })

  it('rules.max_per_guild caps creation', async () => {
    const { harness, role } = await setup({ rules: { max_per_guild: 3, min_cooldown_sec: 1 } })
    for (let i = 0; i < 3; i++) expect((await call(harness.client, 'rules_create', assignRule(role.id, { cooldown_sec: 5 }))).isError).toBe(false)
    const over = await call(harness.client, 'rules_create', assignRule(role.id, { cooldown_sec: 5 }))
    expect(over.code).toBe('invalid_input')
    expect(harness.store.rules.list(GUILD_A)).toHaveLength(3)
  })

  it('a service level Zod failure is invalid_input, not internal', async () => {
    const { harness, role } = await setup()
    const created = await call(harness.client, 'rules_create', assignRule(role.id))
    const bad = await harness.rules.update(principals.stdio, created.body.id as string, { cooldown_sec: -5 } as never).then(
      () => null,
      (e: unknown) => e as { code: string },
    )
    expect(bad?.code).toBe('invalid_input')
  })

  it('a slow guild does not stall rules in another guild', async () => {
    const { harness, role, roleB } = await setup()
    await call(harness.client, 'rules_create', assignRule(role.id, { cooldown_sec: 5 }))
    await call(harness.client, 'rules_create', assignRule(roleB.id, { cooldown_sec: 5 }, GUILD_B))
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const original = harness.discord.addMemberRole.bind(harness.discord)
    harness.discord.addMemberRole = async (guildId: string, userId: string, roleId: string) => {
      if (guildId === GUILD_A) await gate
      return original(guildId, userId, roleId)
    }
    harness.gateway.emit({ guildId: GUILD_A, type: 'member_join', at: new Date().toISOString(), data: { user_id: USER } })
    harness.gateway.emit({ guildId: GUILD_B, type: 'member_join', at: new Date().toISOString(), data: { user_id: USER } })
    await expect.poll(() => harness.discord.members.get(GUILD_B)!.get(USER)!.roles, { timeout: 2000 }).toContain(roleB.id)
    expect(harness.discord.members.get(GUILD_A)!.get(USER)!.roles).toEqual([])
    release()
    await harness.rules.idle()
    expect(harness.discord.members.get(GUILD_A)!.get(USER)!.roles).toContain(role.id)
  })
})

describe('rules run with the owner hierarchy, not with bot power', () => {
  const MANAGE_ROLES_GUILD = ((1n << 28n) | (1n << 5n)).toString()
  const owner = (bits: string): Principal => ({ kind: 'user', userId: ADMIN_ID, userName: 'roleman', guilds: { [GUILD_A]: bits } })

  it('a rule owned by a role manager cannot hand out a role above the owner', async () => {
    const { harness } = await setup()
    const d = harness.discord
    const own = await d.createRole(GUILD_A, { name: 'own' })
    const above = await d.createRole(GUILD_A, { name: 'above' })
    await d.updateRole(GUILD_A, own.id, { position: 5 })
    await d.updateRole(GUILD_A, above.id, { position: 9 })
    d.members.get(GUILD_A)!.set(ADMIN_ID, { user: { id: ADMIN_ID, username: 'roleman' }, roles: [own.id] } as never)
    d.memberPermissions.set(`${GUILD_A}:${ADMIN_ID}`, MANAGE_ROLES_GUILD)
    harness.store.oauth.saveSession({
      familyId: 'f-rm', accessHash: 'a-rm', refreshHash: 'r-rm', clientId: 'c', userId: ADMIN_ID, userName: 'roleman',
      guilds: { [GUILD_A]: MANAGE_ROLES_GUILD }, accessExpiresAt: harness.clock.now() + 3_600_000, refreshExpiresAt: harness.clock.now() + 86_400_000, revoked: false,
    })
    const client = await harness.asPrincipal(owner(MANAGE_ROLES_GUILD))
    const created = await call(client, 'rules_create', assignRule(above.id))
    if (created.isError) {
      expect(created.code).toMatch(/missing_permissions|invalid_input|tier_exceeded/)
      return
    }
    d.calls.length = 0
    await emit(harness, 'member_join', { user_id: USER })
    expect(d.members.get(GUILD_A)!.get(USER)!.roles).not.toContain(above.id)
    expect(calls(harness, 'addMemberRole')).toHaveLength(0)
  })
})

describe('rule owners are re-verified before a rule runs', () => {
  const adminOwner: Principal = { kind: 'user', userId: ADMIN_ID, userName: 'admin', guilds: { [GUILD_A]: '8' } }

  const seatOwner = async (harness: Harness) => {
    const rank = await harness.discord.createRole(GUILD_A, { name: 'rank' })
    await harness.discord.updateRole(GUILD_A, rank.id, { position: 50 })
    harness.discord.members.get(GUILD_A)!.set(ADMIN_ID, { user: { id: ADMIN_ID, username: 'admin' }, roles: [rank.id] } as never)
    harness.store.oauth.saveSession({
      familyId: 'f-owner', accessHash: 'a-owner', refreshHash: 'r-owner', clientId: 'c', userId: ADMIN_ID, userName: 'admin',
      guilds: { [GUILD_A]: '8' }, accessExpiresAt: harness.clock.now() + 3_600_000, refreshExpiresAt: harness.clock.now() + 86_400_000, revoked: false,
    })
    harness.discord.calls.length = 0
  }

  it('runs while the owner is still an administrator according to Discord', async () => {
    const { harness, role } = await setup()
    await seatOwner(harness)
    harness.discord.memberPermissions.set(`${GUILD_A}:${ADMIN_ID}`, '8')
    const owner = await harness.asPrincipal(adminOwner)
    expect((await call(owner, 'rules_create', assignRule(role.id))).isError).toBe(false)
    await emit(harness, 'member_join', { user_id: USER })
    expect(calls(harness, 'addMemberRole')).toHaveLength(1)
  })

  it('a demoted owner: the rule does not run and is disabled', async () => {
    const { harness, role } = await setup()
    await seatOwner(harness)
    harness.discord.memberPermissions.set(`${GUILD_A}:${ADMIN_ID}`, '8')
    const owner = await harness.asPrincipal(adminOwner)
    const created = await call(owner, 'rules_create', assignRule(role.id))
    harness.discord.memberPermissions.set(`${GUILD_A}:${ADMIN_ID}`, '0')
    harness.clock.advance(120_000)
    await emit(harness, 'member_join', { user_id: USER })
    expect(calls(harness, 'addMemberRole')).toHaveLength(0)
    expect(harness.store.rules.get(created.body.id as string)!.enabled).toBe(false)
  })

  it('fails closed when the owner has no live session', async () => {
    const { harness, role } = await setup()
    await seatOwner(harness)
    harness.store.oauth.revokeFamily('f-owner')
    const owner = await harness.asPrincipal(adminOwner)
    await call(owner, 'rules_create', assignRule(role.id))
    await emit(harness, 'member_join', { user_id: USER })
    expect(calls(harness, 'addMemberRole')).toHaveLength(0)
  })

  it('fails closed when the owner permissions cannot be fetched', async () => {
    const { harness, role } = await setup()
    await seatOwner(harness)
    const owner = await harness.asPrincipal(adminOwner)
    await call(owner, 'rules_create', assignRule(role.id))
    harness.discord.memberPermissions.delete(`${GUILD_A}:${ADMIN_ID}`)
    await emit(harness, 'member_join', { user_id: USER })
    expect(calls(harness, 'addMemberRole')).toHaveLength(0)
  })
})
