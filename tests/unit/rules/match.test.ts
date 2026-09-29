import { describe, expect, it } from 'vitest'
import type { Condition, NormalizedEvent, Rule } from '../../../src/contracts/index.js'
import { eventMatches } from '../../../src/rules/match.js'

const NOW = Date.parse('2026-06-10T00:00:00Z')
const G = '111111111111111111'

const ev = (data: Record<string, unknown> = {}, type: NormalizedEvent['type'] = 'member_join'): NormalizedEvent => ({
  id: 1, guildId: G, type, at: '2026-06-10T00:00:00.000Z', data,
})
const rule = (conditions: Condition[] = [], filter: Record<string, unknown> = {}, event: NormalizedEvent['type'] = 'member_join'): Pick<Rule, 'trigger' | 'conditions'> => ({
  trigger: { event, filter },
  conditions,
})

describe('eventMatches', () => {
  it('requires matching event type', () => {
    expect(eventMatches(rule(), ev({}, 'member_remove'), NOW)).toBe(false)
    expect(eventMatches(rule(), ev(), NOW)).toBe(true)
  })

  it('filter is an equality map on data, all keys must match', () => {
    const r = rule([], { user_id: '5', bot: false })
    expect(eventMatches(r, ev({ user_id: '5', bot: false, extra: 1 }), NOW)).toBe(true)
    expect(eventMatches(r, ev({ user_id: '5', bot: true }), NOW)).toBe(false)
    expect(eventMatches(r, ev({ user_id: '5' }), NOW)).toBe(false)
  })

  it('equals', () => {
    const c: Condition = { op: 'equals', field: 'a.b', value: 3 }
    expect(eventMatches(rule([c]), ev({ a: { b: 3 } }), NOW)).toBe(true)
    expect(eventMatches(rule([c]), ev({ a: { b: 4 } }), NOW)).toBe(false)
    expect(eventMatches(rule([c]), ev({}), NOW)).toBe(false)
  })

  it('in', () => {
    const c: Condition = { op: 'in', field: 'k', values: ['x', 'y'] }
    expect(eventMatches(rule([c]), ev({ k: 'y' }), NOW)).toBe(true)
    expect(eventMatches(rule([c]), ev({ k: 'z' }), NOW)).toBe(false)
  })

  it('matches', () => {
    const c: Condition = { op: 'matches', field: 'username', pattern: '^spam\\d+$' }
    expect(eventMatches(rule([c]), ev({ username: 'spam123' }), NOW)).toBe(true)
    expect(eventMatches(rule([c]), ev({ username: 'xspam123' }), NOW)).toBe(false)
    expect(eventMatches(rule([c]), ev({ username: 5 }), NOW)).toBe(false)
  })

  it('matches is false for invalid regex and catastrophic nested quantifiers', () => {
    expect(eventMatches(rule([{ op: 'matches', field: 'u', pattern: '(' }]), ev({ u: 'a' }), NOW)).toBe(false)
    expect(eventMatches(rule([{ op: 'matches', field: 'u', pattern: '(a+)+$' }]), ev({ u: 'a'.repeat(40) + '!' }), NOW)).toBe(false)
  })

  it('matches truncates input to 2000 chars', () => {
    const c: Condition = { op: 'matches', field: 'u', pattern: 'z$' }
    expect(eventMatches(rule([c]), ev({ u: 'a'.repeat(2000) + 'z' }), NOW)).toBe(false)
  })

  it('member_has_role', () => {
    const c: Condition = { op: 'member_has_role', role_id: 'r1' }
    expect(eventMatches(rule([c]), ev({ roles: ['r0', 'r1'] }), NOW)).toBe(true)
    expect(eventMatches(rule([c]), ev({ roles: ['r0'] }), NOW)).toBe(false)
    expect(eventMatches(rule([c]), ev({}), NOW)).toBe(false)
  })

  it('account_age_lt_days', () => {
    const c: Condition = { op: 'account_age_lt_days', days: 7 }
    expect(eventMatches(rule([c]), ev({ account_created_at: '2026-06-08T00:00:00Z' }), NOW)).toBe(true)
    expect(eventMatches(rule([c]), ev({ account_created_at: '2026-05-01T00:00:00Z' }), NOW)).toBe(false)
    expect(eventMatches(rule([c]), ev({ account_created_at: null }), NOW)).toBe(false)
    expect(eventMatches(rule([c]), ev({ account_created_at: 'garbage' }), NOW)).toBe(false)
  })

  it('message_contains is case-insensitive and false without content', () => {
    const c: Condition = { op: 'message_contains', text: 'Free NITRO' }
    expect(eventMatches(rule([c], {}, 'message_create'), ev({ content: 'get free nitro now' }, 'message_create'), NOW)).toBe(true)
    expect(eventMatches(rule([c], {}, 'message_create'), ev({ content: 'hello' }, 'message_create'), NOW)).toBe(false)
    expect(eventMatches(rule([c], {}, 'message_create'), ev({}, 'message_create'), NOW)).toBe(false)
  })

  it('all conditions must hold', () => {
    const cs: Condition[] = [{ op: 'equals', field: 'a', value: 1 }, { op: 'equals', field: 'b', value: 2 }]
    expect(eventMatches(rule(cs), ev({ a: 1, b: 2 }), NOW)).toBe(true)
    expect(eventMatches(rule(cs), ev({ a: 1, b: 3 }), NOW)).toBe(false)
  })
})
