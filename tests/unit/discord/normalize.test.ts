import { describe, expect, it } from 'vitest'
import { normalizeGatewayEvent as n } from '../../../src/discord/normalize.js'

const ISO = /^\d{4}-\d{2}-\d{2}T/
const roles = { cache: new Map([['r1', {}], ['r2', {}]]) }

describe('normalizeGatewayEvent', () => {
  const message = {
    id: 'm1', channelId: 'c1', guildId: 'g1', content: 'hello',
    author: { id: 'u1', bot: false }, attachments: { size: 2 },
  }

  it('message_create with content when intent on', () => {
    const e = n.message_create!(message, true)!
    expect(e).toMatchObject({
      guildId: 'g1', type: 'message_create',
      data: { message_id: 'm1', channel_id: 'c1', author_id: 'u1', author_is_bot: false, attachments_count: 2, content: 'hello' },
    })
    expect(e.at).toMatch(ISO)
  })

  it('message_create omits content when intent off', () => {
    const e = n.message_create!(message, false)!
    expect(e.data).toEqual({ message_id: 'm1', channel_id: 'c1', author_id: 'u1', author_is_bot: false, attachments_count: 2 })
    expect('content' in e.data).toBe(false)
  })

  it('message_create marks bot authors', () => {
    const e = n.message_create!({ ...message, author: { id: 'b', bot: true } }, false)!
    expect(e.data.author_is_bot).toBe(true)
  })

  it('message_create tolerates partials', () => {
    const e = n.message_create!({ id: 'm1', channelId: 'c1', guildId: 'g1' }, true)!
    expect(e.data).toMatchObject({ message_id: 'm1', author_id: null, author_is_bot: false, attachments_count: 0 })
  })

  it('message_create without guild is dropped', () => {
    expect(n.message_create!({ id: 'm1', channelId: 'c1', guildId: null }, false)).toBeNull()
  })

  it('message_update uses the new message', () => {
    const e = n.message_update!({ id: 'old' }, message, true)!
    expect(e).toMatchObject({ type: 'message_update', data: { message_id: 'm1', content: 'hello' } })
  })

  it('message_delete', () => {
    expect(n.message_delete!({ id: 'm1', channelId: 'c1', guildId: 'g1' })).toMatchObject({
      guildId: 'g1', type: 'message_delete', data: { message_id: 'm1', channel_id: 'c1' },
    })
  })

  it('member_join', () => {
    const created = new Date('2024-01-02T03:04:05.000Z')
    const e = n.member_join!({ guild: { id: 'g1' }, id: 'u1', user: { username: 'ann', createdAt: created }, roles })!
    expect(e).toMatchObject({
      guildId: 'g1', type: 'member_join',
      data: { user_id: 'u1', username: 'ann', account_created_at: '2024-01-02T03:04:05.000Z', roles: ['r1', 'r2'] },
    })
  })

  it('member_join tolerates a partial user', () => {
    const e = n.member_join!({ guild: { id: 'g1' }, id: 'u1', roles })!
    expect(e.data).toMatchObject({ user_id: 'u1', username: null, account_created_at: null })
  })

  it('member_remove', () => {
    const e = n.member_remove!({ guild: { id: 'g1' }, id: 'u1', user: { username: 'ann' }, roles })!
    expect(e).toMatchObject({ type: 'member_remove', data: { user_id: 'u1', username: 'ann', roles: ['r1', 'r2'] } })
  })

  it('member_ban / member_unban', () => {
    const ban = { guild: { id: 'g1' }, user: { id: 'u1', username: 'ann' } }
    expect(n.member_ban!(ban)).toMatchObject({ guildId: 'g1', type: 'member_ban', data: { user_id: 'u1', username: 'ann' } })
    expect(n.member_unban!(ban)).toMatchObject({ type: 'member_unban', data: { user_id: 'u1', username: 'ann' } })
  })

  it.each(['role_create', 'role_update', 'role_delete'] as const)('%s', (type) => {
    const role = { id: 'r1', name: 'Mod', guild: { id: 'g1' } }
    const e = type === 'role_update' ? n[type]!({ id: 'r1', name: 'old', guild: { id: 'g1' } }, role) : n[type]!(role)
    expect(e).toMatchObject({ guildId: 'g1', type, data: { role_id: 'r1', name: 'Mod' } })
  })

  it.each(['channel_create', 'channel_update', 'channel_delete'] as const)('%s', (type) => {
    const ch = { id: 'c1', name: 'general', type: 0, guildId: 'g1' }
    const e = type === 'channel_update' ? n[type]!({ ...ch, name: 'old' }, ch) : n[type]!(ch)
    expect(e).toMatchObject({ guildId: 'g1', type, data: { channel_id: 'c1', name: 'general', type: 0 } })
  })

  it('channel events without guild are dropped', () => {
    expect(n.channel_create!({ id: 'c1', type: 1 })).toBeNull()
  })

  it('voice_state', () => {
    const e = n.voice_state!({ guild: { id: 'g1' }, id: 'u1', channelId: 'a' }, { guild: { id: 'g1' }, id: 'u1', channelId: null })!
    expect(e).toMatchObject({ guildId: 'g1', type: 'voice_state', data: { user_id: 'u1', old_channel_id: 'a', new_channel_id: null } })
  })

  it.each(['create', 'update', 'delete'] as const)('scheduled_event %s', (action) => {
    const ev = { id: 'e1', name: 'Party', guildId: 'g1' }
    expect(n.scheduled_event!(action, ev)).toMatchObject({
      guildId: 'g1', type: 'scheduled_event', data: { event_id: 'e1', name: 'Party', action },
    })
  })

  describe('member_update', () => {
    const member = (ids: string[]) => ({
      guild: { id: 'g1' }, id: 'u1', user: { username: 'ann' }, roles: { cache: new Map(ids.map((i) => [i, {}])) },
    })

    it('emits when roles changed', () => {
      const e = n.member_update!(member(['r1', 'r2']), member(['r1', 'r3']))!
      expect(e).toMatchObject({
        guildId: 'g1', type: 'member_update',
        data: { user_id: 'u1', username: 'ann', old_roles: ['r1', 'r2'], new_roles: ['r1', 'r3'] },
      })
    })

    it('returns null when roles are unchanged regardless of order', () => {
      expect(n.member_update!(member(['r1', 'r2']), member(['r2', 'r1']))).toBeNull()
    })

    it('emits with empty old_roles when the old member is an uncached partial', () => {
      const e = n.member_update!({ guild: { id: 'g1' }, id: 'u1', partial: true }, member(['r1']))!
      expect(e.data).toMatchObject({ old_roles: [], new_roles: ['r1'] })
    })
  })
})
