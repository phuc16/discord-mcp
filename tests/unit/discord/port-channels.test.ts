import { describe, expect, it } from 'vitest'
import { channelMethods } from '../../../src/discord/port-channels.js'
import { type Call, recordingRest } from './helpers.js'

const setup = (responses: Record<string, unknown> = {}) => {
  const calls: Call[] = []
  return { calls, m: channelMethods(recordingRest(calls, responses)) }
}

describe('channel methods', () => {
  it('listChannels / getChannel', async () => {
    const { calls, m } = setup()
    await m.listChannels('1')
    await m.getChannel('2')
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/channels' },
      { verb: 'get', route: '/channels/2' },
    ])
  })

  it('createChannel', async () => {
    const { calls, m } = setup()
    await m.createChannel('1', { name: 'x' }, 'r')
    expect(calls).toEqual([{ verb: 'post', route: '/guilds/1/channels', body: { name: 'x' }, reason: 'r' }])
  })

  it('updateChannel / deleteChannel', async () => {
    const { calls, m } = setup()
    await m.updateChannel('2', { name: 'y' }, 'r')
    await m.deleteChannel('2', 'r')
    expect(calls).toEqual([
      { verb: 'patch', route: '/channels/2', body: { name: 'y' }, reason: 'r' },
      { verb: 'delete', route: '/channels/2', reason: 'r' },
    ])
  })

  it('moveChannels sends array body', async () => {
    const { calls, m } = setup()
    const positions = [{ id: '2', position: 1, parent_id: null }]
    await m.moveChannels('1', positions)
    expect(calls).toEqual([{ verb: 'patch', route: '/guilds/1/channels', body: positions }])
  })

  it('setChannelPermissions / deleteChannelPermissions', async () => {
    const { calls, m } = setup()
    const body = { type: 0 as const, allow: '1', deny: '2' }
    await m.setChannelPermissions('2', '3', body, 'r')
    await m.deleteChannelPermissions('2', '3', 'r')
    expect(calls).toEqual([
      { verb: 'put', route: '/channels/2/permissions/3', body, reason: 'r' },
      { verb: 'delete', route: '/channels/2/permissions/3', reason: 'r' },
    ])
  })

  it('listActiveThreads returns threads', async () => {
    const { calls, m } = setup({ '/guilds/1/threads/active': { threads: [{ id: 't' }], members: [] } })
    expect(await m.listActiveThreads('1')).toEqual([{ id: 't' }])
    expect(calls).toEqual([{ verb: 'get', route: '/guilds/1/threads/active' }])
  })

  it('listArchivedThreads returns threads with query', async () => {
    const { calls, m } = setup({ '/channels/2/threads/archived/private': { threads: [{ id: 't' }] } })
    expect(await m.listArchivedThreads('2', { kind: 'private', before: 'b', limit: 5 })).toEqual([{ id: 't' }])
    expect(calls).toEqual([
      { verb: 'get', route: '/channels/2/threads/archived/private', query: { before: 'b', limit: 5 } },
    ])
  })

  it('createThread from message strips message_id', async () => {
    const { calls, m } = setup()
    await m.createThread('2', { name: 't', message_id: '9' }, 'r')
    expect(calls).toEqual([{ verb: 'post', route: '/channels/2/messages/9/threads', body: { name: 't' }, reason: 'r' }])
  })

  it('createThread standalone', async () => {
    const { calls, m } = setup()
    await m.createThread('2', { name: 't', type: 11 })
    expect(calls).toEqual([{ verb: 'post', route: '/channels/2/threads', body: { name: 't', type: 11 } }])
  })

  it('createForumPost', async () => {
    const { calls, m } = setup()
    const spec = { name: 'p', message: { content: 'hi' } }
    await m.createForumPost('2', spec, 'r')
    expect(calls).toEqual([{ verb: 'post', route: '/channels/2/threads', body: spec, reason: 'r' }])
  })

  it('thread members add and remove', async () => {
    const { calls, m } = setup()
    await m.addThreadMember('t', 'u')
    await m.removeThreadMember('t', 'u')
    expect(calls).toEqual([
      { verb: 'put', route: '/channels/t/thread-members/u' },
      { verb: 'delete', route: '/channels/t/thread-members/u' },
    ])
  })
})
