import { describe, expect, it } from 'vitest'
import type { EffectivePolicy, NormalizedEvent, Principal, Rule, Services } from '../../../src/contracts/index.js'
import { metaTools } from '../../../src/tools/meta.js'
import { G, OTHER_G, byName, id, makeCtx, principal, run } from './helpers.js'

const t = (name: string) => byName(metaTools, name)
const RID = 'rule-1'
const rule = { id: RID, guild_id: G } as Rule
const event: NormalizedEvent = { id: 5, guildId: G, type: 'member_join', at: '2026-01-01T00:00:00.000Z', data: { user_id: id('4') } }

const svc = (over: Partial<{ [K in keyof Services]: Partial<Services[K]> }>): Services => ({
  events: {}, rules: {}, audit: {}, policy: {}, ...over,
}) as unknown as Services

describe('server_whoami / server_policy', () => {
  const user: Principal = { kind: 'user', userId: id('4'), userName: 'alice', guilds: { [G]: '8' } }
  it('server_whoami is unscoped read', async () => {
    const tool = t('server_whoami')
    expect(tool.unscoped).toBe(true)
    expect(tool.tier).toBe('read')
    expect(tool.guildFrom({})).toBeNull()
    expect(await run(tool, makeCtx({ principal: user }), {})).toEqual({ kind: 'user', user_id: id('4'), user_name: 'alice', guild_ids: [G] })
  })
  it('server_whoami handles stdio principal', async () => {
    expect(await run(t('server_whoami'), makeCtx({ principal }), {})).toEqual({ kind: 'stdio', user_id: null, user_name: 'tester', guild_ids: [] })
  })
  it('server_policy returns effective policy', async () => {
    const policy: EffectivePolicy = { guilds: { [G]: { maxTier: 'write', effectiveTier: 'read' } }, deniedTools: ['guild_prune'] }
    const ctx = makeCtx({ services: svc({ policy: { effective: (p) => (p === principal ? policy : ({} as EffectivePolicy)) } }) })
    const tool = t('server_policy')
    expect(tool.unscoped).toBe(true)
    expect(tool.guildFrom({})).toBeNull()
    expect(await run(tool, ctx, {})).toEqual(policy)
  })
})

describe('events_poll', () => {
  it('forwards query with defaults and returns cursor', async () => {
    const seen: unknown[] = []
    const ctx = makeCtx({ services: svc({ events: { poll: async (_p, q) => { seen.push(q); return [event] } } }) })
    const out = await run(t('events_poll'), ctx, { guild_id: G })
    expect(seen).toEqual([{ guildId: G, sinceId: 0, limit: 100 }])
    expect(out).toEqual({ items: [event], next_cursor: '5' })
  })
  it('forwards types, since_id and limit', async () => {
    const seen: unknown[] = []
    const ctx = makeCtx({ services: svc({ events: { poll: async (_p, q) => { seen.push(q); return [] } } }) })
    const out = await run(t('events_poll'), ctx, { guild_id: G, since_id: 9, types: ['message_create'], limit: 500 })
    expect(seen).toEqual([{ guildId: G, sinceId: 9, types: ['message_create'], limit: 500 }])
    expect(out).toEqual({ items: [] })
  })
  it('validates limit and types', () => {
    const s = t('events_poll').input
    expect(s.safeParse({ guild_id: G, limit: 501 }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, types: ['nope'] }).success).toBe(false)
  })
})

describe('rules tools', () => {
  const validRule = { guild_id: G, trigger: { event: 'member_join' }, actions: [{ tool: 'roles_assign', input_template: { user_id: '{{user_id}}' } }] }
  it('rules_create applies defaults and delegates', async () => {
    const seen: unknown[] = []
    const ctx = makeCtx({ services: svc({ rules: { create: async (_p, input) => { seen.push(input); return rule } } }) })
    expect(await run(t('rules_create'), ctx, validRule)).toEqual(rule)
    expect(seen[0]).toMatchObject({ guild_id: G, cooldown_sec: 0, allow_destructive: false, enabled: true, conditions: [], trigger: { event: 'member_join', filter: {} } })
    expect(t('rules_create').tier).toBe('write')
  })
  it('rules_create rejects bad guild and empty actions', () => {
    const s = t('rules_create').input
    expect(s.safeParse({ ...validRule, guild_id: 'x' }).success).toBe(false)
    expect(s.safeParse({ ...validRule, actions: [] }).success).toBe(false)
  })
  it('rules_list delegates', async () => {
    const ctx = makeCtx({ services: svc({ rules: { list: async (_p, g) => (g === G ? [rule] : []) } }) })
    expect(await run(t('rules_list'), ctx, { guild_id: G })).toEqual({ items: [rule] })
    expect(t('rules_list').tier).toBe('read')
  })
  it('rules_update sends only supplied fields', async () => {
    const seen: unknown[] = []
    const ctx = makeCtx({ services: svc({ rules: { list: async () => [rule], update: async (_p, rid, patch) => { seen.push([rid, patch]); return rule } } }) })
    await run(t('rules_update'), ctx, { guild_id: G, rule_id: RID, enabled: false })
    expect(seen).toEqual([[RID, { enabled: false }]])
  })
  it('rules_update rejects rule of another guild without updating', async () => {
    let updated = false
    const ctx = makeCtx({ services: svc({ rules: { list: async () => [], update: async () => { updated = true; return rule } } }) })
    await expect(run(t('rules_update'), ctx, { guild_id: OTHER_G, rule_id: RID, enabled: true })).rejects.toMatchObject({ code: 'not_found' })
    expect(updated).toBe(false)
  })
  it('rules_delete is write tier, checks guild and removes', async () => {
    const removed: string[] = []
    const ctx = makeCtx({ services: svc({ rules: { list: async () => [rule], remove: async (_p, rid) => { removed.push(rid) } } }) })
    expect(t('rules_delete').tier).toBe('write')
    await run(t('rules_delete'), ctx, { guild_id: G, rule_id: RID })
    expect(removed).toEqual([RID])
  })
  it('rules_delete rejects foreign rule', async () => {
    const ctx = makeCtx({ services: svc({ rules: { list: async () => [], remove: async () => undefined } }) })
    await expect(run(t('rules_delete'), ctx, { guild_id: G, rule_id: RID })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('rules_test is read tier and delegates', async () => {
    const result = { matched: true, actions: [] }
    const ctx = makeCtx({ services: svc({ rules: { list: async () => [rule], test: async () => result } }) })
    expect(t('rules_test').tier).toBe('read')
    expect(await run(t('rules_test'), ctx, { guild_id: G, rule_id: RID, sample_event: event })).toEqual(result)
  })
  it('rules_test rejects foreign rule and mismatched sample guild', async () => {
    const ctx = makeCtx({ services: svc({ rules: { list: async () => [rule], test: async () => ({ matched: false, actions: [] }) } }) })
    await expect(run(t('rules_test'), ctx, { guild_id: G, rule_id: RID, sample_event: { ...event, guildId: OTHER_G } })).rejects.toMatchObject({ code: 'invalid_input' })
    const none = makeCtx({ services: svc({ rules: { list: async () => [] } }) })
    await expect(run(t('rules_test'), none, { guild_id: G, rule_id: RID, sample_event: event })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('audit_query', () => {
  it('maps input to AuditQuery and delegates', async () => {
    const seen: unknown[] = []
    const ctx = makeCtx({ services: svc({ audit: { query: async (_p, q) => { seen.push(q); return [] } } }) })
    const out = await run(t('audit_query'), ctx, { guild_id: G, tool: 'mod_ban', actor_user_id: id('4'), limit: 10, before_id: 77 })
    expect(seen).toEqual([{ guildId: G, tool: 'mod_ban', actorUserId: id('4'), limit: 10, beforeId: 77 }])
    expect(out).toEqual({ items: [] })
  })
  it('defaults limit and bounds it', async () => {
    const seen: unknown[] = []
    const ctx = makeCtx({ services: svc({ audit: { query: async (_p, q) => { seen.push(q); return [] } } }) })
    await run(t('audit_query'), ctx, { guild_id: G })
    expect(seen).toEqual([{ guildId: G, limit: 50 }])
    expect(t('audit_query').input.safeParse({ guild_id: G, limit: 201 }).success).toBe(false)
  })
})
