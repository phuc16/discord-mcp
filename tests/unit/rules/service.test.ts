import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import type { AnyToolDef, NormalizedEvent, Principal, RuleInput, Tier } from '../../../src/contracts/index.js'
import { createRulesService } from '../../../src/rules/service.js'
import type { RulesService } from '../../../src/rules/service.js'
import { PERM, PolicyEngine, createAuditWriter, createBulkLimiter, createConfirmService } from '../../../src/safety/index.js'
import type { PipelineDeps } from '../../../src/safety/index.js'
import { openStore } from '../../../src/store/index.js'
import type { Store } from '../../../src/store/index.js'

const G = '111111111111111111'
const H = '222222222222222222'
const U = '333333333333333333'
const R1 = '444444444444444444'
const NEWCH = '555555555555555555'

const log = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

const tool = (name: string, tier: Tier, handler: (i: Record<string, unknown>) => unknown = () => ({ ok: true }), group = 'channels'): AnyToolDef =>
  ({
    name,
    group,
    description: 'd',
    tier,
    input: z.object({}).passthrough(),
    guildFrom: (i: Record<string, unknown>) => (i.guild_id as string | undefined) ?? null,
    preview: tier === 'destructive' ? async () => ({ summary: 's', affected: {} }) : undefined,
    handler: async (_c: unknown, i: Record<string, unknown>) => ({ data: handler(i) }),
  }) as unknown as AnyToolDef

const ev = (id: number, type: NormalizedEvent['type'], data: Record<string, unknown>, guildId = G): NormalizedEvent => ({
  id, guildId, type, at: '2026-06-10T00:00:00.000Z', data,
})

const stdio: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }

describe('rules service', () => {
  let store: Store
  let clock: number
  let cb: ((e: NormalizedEvent) => void) | null
  let tools: Map<string, AnyToolDef>
  let calls: { tool: string; input: Record<string, unknown> }[]
  let svc: RulesService
  let policy: PolicyEngine
  let pipeline: PipelineDeps
  let ids: number

  const build = (guilds = { [G]: { max_tier: 'destructive' as Tier }, [H]: { max_tier: 'write' as Tier } }) => {
    policy = new PolicyEngine({ guilds, tools: { deny: [] } })
    pipeline = {
      policy,
      confirm: createConfirmService({ store, now: () => clock }),
      audit: createAuditWriter({ store, logger: log() }),
      limiter: createBulkLimiter({ perMinute: 100, now: () => clock }),
      now: () => clock,
    }
    svc = createRulesService({
      store,
      policy,
      pipeline,
      subscribe: (c) => {
        cb = c
        return () => {
          cb = null
        }
      },
      toolByName: (n) => tools.get(n),
      discord: {} as never,
      services: () => ({}) as never,
      logger: log(),
      now: () => clock,
      newId: () => `rule-${++ids}`,
    })
  }

  const addTool = (name: string, tier: Tier, group = 'channels') => {
    tools.set(name, tool(name, tier, (i) => {
      calls.push({ tool: name, input: i })
      return name === 'channels_create' ? { id: NEWCH } : { ok: true }
    }, group))
  }

  const baseInput = (over: Partial<RuleInput> = {}): RuleInput => ({
    guild_id: G,
    trigger: { event: 'member_join', filter: {} },
    conditions: [],
    actions: [{ tool: 'members_add_role', input_template: { user_id: '{{event.data.user_id}}', role_id: R1 } }],
    cooldown_sec: 0,
    allow_destructive: false,
    enabled: true,
    ...over,
  })

  const owner = (userId = U): Principal => ({ kind: 'user', userId, userName: 'owner', guilds: { [G]: PERM.ADMINISTRATOR.toString() } })

  const seedSession = (userId: string, guilds: Record<string, string>) =>
    store.oauth.saveSession({
      familyId: `f-${userId}`, accessHash: `a-${userId}`, refreshHash: `r-${userId}`, clientId: 'c', userId, userName: 'owner',
      guilds, accessExpiresAt: clock + 3600_000, refreshExpiresAt: clock + 86_400_000, revoked: false,
    })

  const fire = async (e: NormalizedEvent) => {
    await svc.handleEvent(e)
  }

  beforeEach(() => {
    store = openStore(':memory:')
    clock = Date.parse('2026-06-10T00:00:00Z')
    cb = null
    calls = []
    ids = 0
    tools = new Map()
    addTool('members_add_role', 'write', 'members')
    addTool('channels_create', 'write')
    addTool('channels_delete', 'destructive')
    build()
  })

  const audits = () => store.audit.query({ limit: 100 }).reverse()

  describe('creation validation', () => {
    it('creates a rule owned by the principal', async () => {
      seedSession(U, { [G]: PERM.ADMINISTRATOR.toString() })
      const rule = await svc.create(owner(), baseInput())
      expect(rule).toMatchObject({ id: 'rule-1', owner_user_id: U, guild_id: G, disabled_reason: null })
      expect(store.rules.get('rule-1')).not.toBeNull()
    })

    it('stdio principals own with null user', async () => {
      const rule = await svc.create(stdio, baseInput())
      expect(rule.owner_user_id).toBeNull()
    })

    it('rejects unknown action tools', async () => {
      await expect(svc.create(stdio, baseInput({ actions: [{ tool: 'nope', input_template: {} }] }))).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('rejects templates referencing non-event data', async () => {
      await expect(
        svc.create(stdio, baseInput({ actions: [{ tool: 'members_add_role', input_template: { user_id: '{{env.SECRET}}' } }] })),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('rejects destructive action without allow_destructive', async () => {
      await expect(
        svc.create(stdio, baseInput({ actions: [{ tool: 'channels_delete', input_template: {} }] })),
      ).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('accepts destructive action with allow_destructive', async () => {
      await expect(
        svc.create(stdio, baseInput({ allow_destructive: true, actions: [{ tool: 'channels_delete', input_template: {} }] })),
      ).resolves.toMatchObject({ allow_destructive: true })
    })

    it('rejects guild not in allowlist', async () => {
      await expect(svc.create(stdio, baseInput({ guild_id: '999999999999999999' }))).rejects.toMatchObject({ code: 'guild_not_allowed' })
    })

    it('rejects owner without write tier', async () => {
      const reader: Principal = { kind: 'user', userId: U, userName: 'r', guilds: { [G]: '0' } }
      await expect(svc.create(reader, baseInput())).rejects.toMatchObject({ code: 'tier_exceeded' })
    })

    it('rejects when guild policy caps below action tier', async () => {
      const p = owner()
      p.guilds[H] = PERM.ADMINISTRATOR.toString()
      await expect(
        svc.create(p, baseInput({ guild_id: H, allow_destructive: true, actions: [{ tool: 'channels_delete', input_template: {} }] })),
      ).rejects.toMatchObject({ code: 'tier_exceeded' })
    })
  })

  describe('ownership', () => {
    it('user may modify only own rules', async () => {
      const r = await svc.create(owner(), baseInput())
      const other = owner('666666666666666666')
      await expect(svc.update(other, r.id, { cooldown_sec: 5 })).rejects.toMatchObject({ code: 'unauthorized' })
      await expect(svc.remove(other, r.id)).rejects.toMatchObject({ code: 'unauthorized' })
      await expect(svc.update(owner(), r.id, { cooldown_sec: 5 })).resolves.toMatchObject({ cooldown_sec: 5 })
      await svc.remove(owner(), r.id)
      expect(store.rules.get(r.id)).toBeNull()
    })

    it('stdio may modify any rule in an allowed guild', async () => {
      const r = await svc.create(owner(), baseInput())
      await expect(svc.update(stdio, r.id, { cooldown_sec: 9 })).resolves.toMatchObject({ cooldown_sec: 9 })
      await expect(svc.remove(stdio, r.id)).resolves.toBeUndefined()
    })

    it('missing rule is not_found', async () => {
      await expect(svc.update(stdio, 'x', {})).rejects.toMatchObject({ code: 'not_found' })
      await expect(svc.remove(stdio, 'x')).rejects.toMatchObject({ code: 'not_found' })
    })

    it('update revalidates and cannot move guild', async () => {
      const r = await svc.create(stdio, baseInput())
      await expect(svc.update(stdio, r.id, { guild_id: H })).rejects.toMatchObject({ code: 'invalid_input' })
      await expect(svc.update(stdio, r.id, { actions: [{ tool: 'channels_delete', input_template: {} }] })).rejects.toMatchObject({ code: 'invalid_input' })
    })

    it('list requires read access', async () => {
      await svc.create(stdio, baseInput())
      expect(await svc.list(stdio, G)).toHaveLength(1)
      await expect(svc.list(owner('777777777777777777'), H)).rejects.toMatchObject({ code: 'guild_not_allowed' })
    })

    it('re-enabling clears disabled_reason', async () => {
      const r = await svc.create(stdio, baseInput())
      store.rules.update(r.id, { enabled: false, disabled_reason: 'x' })
      const u = await svc.update(stdio, r.id, { enabled: true })
      expect(u).toMatchObject({ enabled: true, disabled_reason: null })
    })
  })

  describe('execution', () => {
    it('runs actions through the pipeline with rendered inputs and guild forced', async () => {
      seedSession(U, { [G]: PERM.ADMINISTRATOR.toString() })
      await svc.create(owner(), baseInput())
      await fire(ev(1, 'member_join', { user_id: '42' }))
      expect(calls).toEqual([{ tool: 'members_add_role', input: { user_id: '42', role_id: R1, guild_id: G } }])
      const a = audits()
      expect(a).toHaveLength(1)
      expect(a[0]).toMatchObject({ tool: 'members_add_role', outcome: 'ok', correlationId: 'rule:rule-1:1', actorUserId: U })
    })

    it('forces the rule guild even if template names another', async () => {
      seedSession(U, { [G]: PERM.ADMINISTRATOR.toString() })
      await svc.create(owner(), baseInput({ actions: [{ tool: 'channels_create', input_template: { guild_id: H, name: 'x' } }] }))
      await fire(ev(1, 'member_join', {}))
      expect(calls).toEqual([])
      expect(audits()[0]).toMatchObject({ outcome: 'denied', errorCode: 'guild_not_allowed' })
    })

    it('skips non-matching events and other guilds', async () => {
      await svc.create(stdio, baseInput({ trigger: { event: 'member_join', filter: { user_id: '1' } } }))
      await fire(ev(1, 'member_join', { user_id: '2' }))
      await fire(ev(2, 'member_join', { user_id: '1' }, H))
      await fire(ev(3, 'member_remove', { user_id: '1' }))
      expect(calls).toEqual([])
    })

    it('respects conditions', async () => {
      await svc.create(stdio, baseInput({ conditions: [{ op: 'equals', field: 'username', value: 'bad' }] }))
      await fire(ev(1, 'member_join', { user_id: '1', username: 'good' }))
      expect(calls).toHaveLength(0)
      await fire(ev(2, 'member_join', { user_id: '1', username: 'bad' }))
      expect(calls).toHaveLength(1)
    })

    it('honours cooldown', async () => {
      await svc.create(stdio, baseInput({ cooldown_sec: 60 }))
      await fire(ev(1, 'member_join', { user_id: '1' }))
      await fire(ev(2, 'member_join', { user_id: '2' }))
      expect(calls).toHaveLength(1)
      clock += 61_000
      await fire(ev(3, 'member_join', { user_id: '3' }))
      expect(calls).toHaveLength(2)
    })

    it('disabled rules do not run', async () => {
      await svc.create(stdio, baseInput({ enabled: false }))
      await fire(ev(1, 'member_join', { user_id: '1' }))
      expect(calls).toHaveLength(0)
    })

    it('template errors stop the rule and are audited', async () => {
      await svc.create(stdio, baseInput({ actions: [{ tool: 'members_add_role', input_template: { user_id: '{{event.data.missing}}' } }] }))
      await fire(ev(1, 'member_join', { user_id: '1' }))
      expect(calls).toHaveLength(0)
      expect(audits()[0]).toMatchObject({ outcome: 'error', errorCode: 'invalid_input' })
    })

    it('failing action stops later actions', async () => {
      tools.set('boom', tool('boom', 'write', () => { throw new Error('x') }))
      await svc.create(stdio, baseInput({ actions: [
        { tool: 'boom', input_template: {} },
        { tool: 'members_add_role', input_template: {} },
      ] }))
      await fire(ev(1, 'member_join', { user_id: '1' }))
      expect(calls).toHaveLength(0)
    })

    it('destructive action with allow_destructive runs preauthorized', async () => {
      await svc.create(stdio, baseInput({ allow_destructive: true, actions: [{ tool: 'channels_delete', input_template: { channel_id: '{{event.data.channel_id}}' } }] }))
      await fire(ev(1, 'member_join', { channel_id: '9' }))
      expect(calls).toEqual([{ tool: 'channels_delete', input: { channel_id: '9', guild_id: G } }])
    })

    it('destructive action never executes when allow_destructive is false', async () => {
      const r = await svc.create(stdio, baseInput())
      store.rules.update(r.id, { actions: [{ tool: 'channels_delete', input_template: {} }] })
      await fire(ev(1, 'member_join', {}))
      expect(calls).toHaveLength(0)
      expect(audits()[0]).toMatchObject({ outcome: 'denied' })
    })

    it('per-guild action rate limit of 30 per minute', async () => {
      await svc.create(stdio, baseInput())
      for (let i = 1; i <= 35; i++) await fire(ev(i, 'member_join', { user_id: String(i) }))
      expect(calls).toHaveLength(30)
      clock += 60_000
      await fire(ev(100, 'member_join', { user_id: 'z' }))
      expect(calls).toHaveLength(31)
    })
  })

  describe('loop guard', () => {
    it('own action result does not retrigger the same rule but triggers others', async () => {
      await svc.create(stdio, baseInput({
        trigger: { event: 'channel_create', filter: {} },
        actions: [{ tool: 'channels_create', input_template: { name: 'mirror' } }],
      }))
      await svc.create(stdio, baseInput({
        trigger: { event: 'channel_create', filter: {} },
        actions: [{ tool: 'members_add_role', input_template: { channel: '{{event.data.channel_id}}' } }],
      }))
      await fire(ev(1, 'channel_create', { channel_id: '888888888888888888' }))
      expect(calls.map((c) => c.tool)).toEqual(['channels_create', 'members_add_role'])
      calls = []
      await fire(ev(2, 'channel_create', { channel_id: NEWCH }))
      expect(calls.map((c) => c.tool)).toEqual(['members_add_role'])
    })

    it('events arriving during an action are handled after it and still guarded', async () => {
      tools.set('channels_create', tool('channels_create', 'write', (i) => {
        calls.push({ tool: 'channels_create', input: i })
        cb?.(ev(2, 'channel_create', { channel_id: NEWCH }))
        return { id: NEWCH }
      }))
      await svc.create(stdio, baseInput({
        trigger: { event: 'channel_create', filter: {} },
        actions: [{ tool: 'channels_create', input_template: {} }],
      }))
      svc.start()
      cb?.(ev(1, 'channel_create', { channel_id: '888888888888888888' }))
      await svc.idle()
      expect(calls).toHaveLength(1)
    })

    it('guard expires after 30s', async () => {
      await svc.create(stdio, baseInput({
        trigger: { event: 'channel_create', filter: {} },
        actions: [{ tool: 'channels_create', input_template: {} }],
      }))
      await fire(ev(1, 'channel_create', { channel_id: '888888888888888888' }))
      clock += 31_000
      calls = []
      await fire(ev(2, 'channel_create', { channel_id: NEWCH }))
      expect(calls).toHaveLength(1)
    })
  })

  describe('fail closed', () => {
    it('disables rule and audits denial when owner falls below action tier', async () => {
      seedSession(U, { [G]: PERM.ADMINISTRATOR.toString() })
      const r = await svc.create(owner(), baseInput())
      store.oauth.rotateRefresh({
        oldRefreshHash: `r-${U}`, newRefreshHash: 'nr', newAccessHash: 'na',
        accessExpiresAt: clock + 1000, refreshExpiresAt: clock + 100000, guilds: { [G]: '0' }, now: clock,
      })
      await fire(ev(1, 'member_join', { user_id: '1' }))
      expect(calls).toHaveLength(0)
      expect(store.rules.get(r.id)).toMatchObject({ enabled: false })
      expect(store.rules.get(r.id)?.disabled_reason).toMatch(/tier/)
      expect(audits().some((a) => a.outcome === 'denied' && a.guildId === G)).toBe(true)
    })

    it('disables rule when owner has no live session', async () => {
      const r = await svc.create(owner(), baseInput())
      await fire(ev(1, 'member_join', { user_id: '1' }))
      expect(calls).toHaveLength(0)
      expect(store.rules.get(r.id)?.enabled).toBe(false)
    })

    it('disables when policy tightens below action tier', async () => {
      const r = await svc.create(stdio, baseInput({ allow_destructive: true, actions: [{ tool: 'channels_delete', input_template: {} }] }))
      build({ [G]: { max_tier: 'write' }, [H]: { max_tier: 'write' } })
      await fire(ev(1, 'member_join', {}))
      expect(calls).toHaveLength(0)
      expect(store.rules.get(r.id)?.enabled).toBe(false)
    })

    it('disableForOwner disables only that owners rules', async () => {
      const a = await svc.create(owner(), baseInput())
      const b = await svc.create(owner('666666666666666666'), baseInput())
      svc.disableForOwner(U, 'demoted')
      expect(store.rules.get(a.id)).toMatchObject({ enabled: false, disabled_reason: 'demoted' })
      expect(store.rules.get(b.id)?.enabled).toBe(true)
    })
  })

  describe('test()', () => {
    it('returns matched flag and rendered inputs without calling handlers', async () => {
      const r = await svc.create(stdio, baseInput({ conditions: [{ op: 'equals', field: 'username', value: 'bad' }] }))
      const hit = await svc.test(stdio, r.id, ev(1, 'member_join', { user_id: '42', username: 'bad' }))
      expect(hit).toEqual({
        matched: true,
        actions: [{ tool: 'members_add_role', input: { user_id: '42', role_id: R1, guild_id: G }, outcome: 'would_run' }],
      })
      const miss = await svc.test(stdio, r.id, ev(2, 'member_join', { user_id: '42', username: 'ok' }))
      expect(miss).toEqual({ matched: false, actions: [] })
      expect(calls).toHaveLength(0)
      expect(audits()).toHaveLength(0)
    })

    it('reports blocked destructive actions and template errors', async () => {
      const r = await svc.create(stdio, baseInput({ allow_destructive: true, actions: [
        { tool: 'channels_delete', input_template: {} },
        { tool: 'members_add_role', input_template: { u: '{{event.data.nope}}' } },
      ] }))
      const t = await svc.test(stdio, r.id, ev(1, 'member_join', {}))
      expect(t.actions[0]!.outcome).toBe('would_run')
      expect(t.actions[1]!.outcome).toMatch(/^error: template: missing/)
    })

    it('requires read access to the rule guild', async () => {
      const r = await svc.create(stdio, baseInput())
      await expect(svc.test({ kind: 'user', userId: 'x', userName: 'x', guilds: {} }, r.id, ev(1, 'member_join', {}))).rejects.toMatchObject({ code: 'guild_not_allowed' })
    })
  })

  it('start subscribes and stop unsubscribes', async () => {
    await svc.create(stdio, baseInput())
    svc.start()
    cb?.(ev(1, 'member_join', { user_id: '1' }))
    await svc.idle()
    expect(calls).toHaveLength(1)
    svc.stop()
    expect(cb).toBeNull()
  })
})
