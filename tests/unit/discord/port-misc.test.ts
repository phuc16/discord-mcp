import { describe, expect, it } from 'vitest'
import { miscMethods } from '../../../src/discord/port-misc.js'
import { type Call, recordingRest } from './helpers.js'

const setup = (responses: Record<string, unknown> = {}) => {
  const calls: Call[] = []
  return { calls, m: miscMethods(recordingRest(calls, responses)) }
}

describe('misc methods', () => {
  it('webhooks', async () => {
    const { calls, m } = setup({ '/webhooks/5/tok': { id: 'm' } })
    await m.listWebhooks({ guildId: '1' })
    await m.listWebhooks({ channelId: '2' })
    await m.createWebhook('2', { name: 'w' }, 'r')
    await m.updateWebhook('5', { name: 'x' }, 'r')
    expect(await m.executeWebhook('5', 'tok', { content: 'hi' })).toEqual({ id: 'm' })
    await m.deleteWebhook('5', 'r')
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/webhooks' },
      { verb: 'get', route: '/channels/2/webhooks' },
      { verb: 'post', route: '/channels/2/webhooks', body: { name: 'w' }, reason: 'r' },
      { verb: 'patch', route: '/webhooks/5', body: { name: 'x' }, reason: 'r' },
      { verb: 'post', route: '/webhooks/5/tok', body: { content: 'hi' }, query: { wait: 'true' }, auth: false },
      { verb: 'delete', route: '/webhooks/5', reason: 'r' },
    ])
  })

  it('scheduled events', async () => {
    const { calls, m } = setup()
    await m.listScheduledEvents('1')
    await m.getScheduledEvent('1', '3')
    await m.createScheduledEvent('1', { name: 'e' }, 'r')
    await m.updateScheduledEvent('1', '3', { name: 'f' }, 'r')
    await m.listScheduledEventUsers('1', '3', 25)
    await m.deleteScheduledEvent('1', '3', 'r')
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/scheduled-events', query: { with_user_count: 'true' } },
      { verb: 'get', route: '/guilds/1/scheduled-events/3', query: { with_user_count: 'true' } },
      { verb: 'post', route: '/guilds/1/scheduled-events', body: { name: 'e' }, reason: 'r' },
      { verb: 'patch', route: '/guilds/1/scheduled-events/3', body: { name: 'f' }, reason: 'r' },
      { verb: 'get', route: '/guilds/1/scheduled-events/3/users', query: { limit: 25 } },
      { verb: 'delete', route: '/guilds/1/scheduled-events/3', reason: 'r' },
    ])
  })

  it('invites', async () => {
    const { calls, m } = setup()
    await m.listInvites('1')
    await m.createInvite('2', { max_age: 60 }, 'r')
    await m.deleteInvite('abc', 'r')
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/invites' },
      { verb: 'post', route: '/channels/2/invites', body: { max_age: 60 }, reason: 'r' },
      { verb: 'delete', route: '/invites/abc', reason: 'r' },
    ])
  })

  it('emojis', async () => {
    const { calls, m } = setup()
    await m.listEmojis('1')
    await m.createEmoji('1', { name: 'e', image: 'data:image/png;base64,AA==' }, 'r')
    await m.updateEmoji('1', '4', { name: 'f' }, 'r')
    await m.deleteEmoji('1', '4', 'r')
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/emojis' },
      { verb: 'post', route: '/guilds/1/emojis', body: { name: 'e', image: 'data:image/png;base64,AA==' }, reason: 'r' },
      { verb: 'patch', route: '/guilds/1/emojis/4', body: { name: 'f' }, reason: 'r' },
      { verb: 'delete', route: '/guilds/1/emojis/4', reason: 'r' },
    ])
  })

  it('stickers upload multipart', async () => {
    const { calls, m } = setup()
    await m.listStickers('1')
    await m.createSticker('1', { name: 's', description: 'd', tags: 't', file: Buffer.from('png').toString('base64') }, 'r')
    await m.deleteSticker('1', '6', 'r')
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/stickers' },
      {
        verb: 'post',
        route: '/guilds/1/stickers',
        body: { name: 's', description: 'd', tags: 't' },
        reason: 'r',
        files: [{ name: 'sticker.png', key: 'file', data: Buffer.from('png'), contentType: 'image/png' }],
      },
      { verb: 'delete', route: '/guilds/1/stickers/6', reason: 'r' },
    ])
  })

  it.each([
    ['image/apng', 'a.apng'],
    ['application/json', 'a.json'],
  ] as const)('sticker upload uses input filename and content type %s', async (contentType, filename) => {
    const { calls, m } = setup()
    await m.createSticker('1', { name: 's', description: 'd', tags: 't', file: Buffer.from('x').toString('base64'), filename, content_type: contentType })
    expect(calls[0]?.files).toEqual([{ name: filename, key: 'file', data: Buffer.from('x'), contentType }])
  })

  it('listAuditLog', async () => {
    const { calls, m } = setup()
    await m.listAuditLog('1', { user_id: '2', action_type: 22, limit: 10, before: '9' })
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/audit-logs', query: { user_id: '2', action_type: 22, limit: 10, before: '9' } },
    ])
  })
})
