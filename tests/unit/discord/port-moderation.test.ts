import { describe, expect, it } from 'vitest'
import { moderationMethods } from '../../../src/discord/port-moderation.js'
import { type Call, recordingRest } from './helpers.js'

const setup = (responses: Record<string, unknown> = {}) => {
  const calls: Call[] = []
  return { calls, m: moderationMethods(recordingRest(calls, responses)) }
}

describe('moderation methods', () => {
  it('kickMember', async () => {
    const { calls, m } = setup()
    await m.kickMember('1', '2', 'r')
    expect(calls).toEqual([{ verb: 'delete', route: '/guilds/1/members/2', reason: 'r' }])
  })

  it('banMember / unbanMember', async () => {
    const { calls, m } = setup()
    await m.banMember('1', '2', { delete_message_seconds: 60 }, 'r')
    await m.unbanMember('1', '2', 'r')
    expect(calls).toEqual([
      { verb: 'put', route: '/guilds/1/bans/2', body: { delete_message_seconds: 60 }, reason: 'r' },
      { verb: 'delete', route: '/guilds/1/bans/2', reason: 'r' },
    ])
  })

  it('bulkBan', async () => {
    const { calls, m } = setup({ '/guilds/1/bulk-ban': { banned_users: ['2'], failed_users: ['3'] } })
    expect(await m.bulkBan('1', ['2', '3'], { delete_message_seconds: 0 }, 'r')).toEqual({
      banned_users: ['2'],
      failed_users: ['3'],
    })
    expect(calls).toEqual([
      { verb: 'post', route: '/guilds/1/bulk-ban', body: { user_ids: ['2', '3'], delete_message_seconds: 0 }, reason: 'r' },
    ])
  })

  it('listBans', async () => {
    const { calls, m } = setup()
    await m.listBans('1', { limit: 100, after: '5' })
    expect(calls).toEqual([{ verb: 'get', route: '/guilds/1/bans', query: { limit: 100, after: '5' } }])
  })

  it('automod rules', async () => {
    const { calls, m } = setup()
    await m.listAutomodRules('1')
    await m.createAutomodRule('1', { name: 'a' }, 'r')
    await m.updateAutomodRule('1', '9', { enabled: false }, 'r')
    await m.deleteAutomodRule('1', '9', 'r')
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/auto-moderation/rules' },
      { verb: 'post', route: '/guilds/1/auto-moderation/rules', body: { name: 'a' }, reason: 'r' },
      { verb: 'patch', route: '/guilds/1/auto-moderation/rules/9', body: { enabled: false }, reason: 'r' },
      { verb: 'delete', route: '/guilds/1/auto-moderation/rules/9', reason: 'r' },
    ])
  })
})
