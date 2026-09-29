import { describe, expect, it } from 'vitest'
import { messageMethods } from '../../../src/discord/port-messages.js'
import { type Call, recordingRest } from './helpers.js'

const setup = (responses: Record<string, unknown> = {}) => {
  const calls: Call[] = []
  return { calls, m: messageMethods(recordingRest(calls, responses)) }
}

const DISCORD_EPOCH = 1420070400000n
const snowflakeAt = (ms: number, seq: number): string => (((BigInt(ms) - DISCORD_EPOCH) << 22n) | BigInt(seq)).toString()
const DAY = 86_400_000
const fresh = (n: number) => Array.from({ length: n }, (_, i) => snowflakeAt(Date.now() - DAY, i))
const old = (n: number) => Array.from({ length: n }, (_, i) => snowflakeAt(Date.now() - 20 * DAY, i))

describe('message methods', () => {
  it('listMessages', async () => {
    const { calls, m } = setup()
    await m.listMessages('1', { limit: 50, before: '9' })
    expect(calls).toEqual([{ verb: 'get', route: '/channels/1/messages', query: { limit: 50, before: '9' } }])
  })

  it('get / send / edit / delete', async () => {
    const { calls, m } = setup()
    await m.getMessage('1', '2')
    await m.sendMessage('1', { content: 'hi' })
    await m.editMessage('1', '2', { content: 'yo' })
    await m.deleteMessage('1', '2', 'r')
    expect(calls).toEqual([
      { verb: 'get', route: '/channels/1/messages/2' },
      { verb: 'post', route: '/channels/1/messages', body: { content: 'hi' } },
      { verb: 'patch', route: '/channels/1/messages/2', body: { content: 'yo' } },
      { verb: 'delete', route: '/channels/1/messages/2', reason: 'r' },
    ])
  })

  it('pins', async () => {
    const { calls, m } = setup()
    await m.pinMessage('1', '2', 'r')
    await m.unpinMessage('1', '2', 'r')
    expect(calls).toEqual([
      { verb: 'put', route: '/channels/1/messages/pins/2', reason: 'r' },
      { verb: 'delete', route: '/channels/1/messages/pins/2', reason: 'r' },
    ])
  })

  it('listPins reads the current route and unwraps items across pages', async () => {
    let n = 0
    const { calls, m } = setup({
      '/channels/1/messages/pins': () =>
        n++ === 0
          ? { items: [{ pinned_at: 't2', message: { id: 'a' } }], has_more: true }
          : { items: [{ pinned_at: 't1', message: { id: 'b' } }], has_more: false },
    })
    expect(await m.listPins('1')).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(calls).toEqual([
      { verb: 'get', route: '/channels/1/messages/pins', query: { limit: 50 } },
      { verb: 'get', route: '/channels/1/messages/pins', query: { limit: 50, before: 't2' } },
    ])
  })

  it.each(['.', '..', ''])('rejects reaction emoji %j', async (emoji) => {
    const { calls, m } = setup()
    await expect(m.addReaction('1', '2', emoji)).rejects.toMatchObject({ code: 'invalid_input' })
    await expect(m.removeReaction('1', '2', emoji)).rejects.toMatchObject({ code: 'invalid_input' })
    expect(calls).toEqual([])
  })

  it('crosspostMessage', async () => {
    const { calls, m } = setup()
    await m.crosspostMessage('1', '2')
    expect(calls).toEqual([{ verb: 'post', route: '/channels/1/messages/2/crosspost' }])
  })

  it('reactions encode emoji', async () => {
    const { calls, m } = setup()
    await m.addReaction('1', '2', '👍')
    await m.removeReaction('1', '2', '👍')
    await m.removeReaction('1', '2', '👍', '7')
    await m.clearReactions('1', '2')
    const e = encodeURIComponent('👍')
    expect(calls).toEqual([
      { verb: 'put', route: `/channels/1/messages/2/reactions/${e}/@me` },
      { verb: 'delete', route: `/channels/1/messages/2/reactions/${e}/@me` },
      { verb: 'delete', route: `/channels/1/messages/2/reactions/${e}/7` },
      { verb: 'delete', route: '/channels/1/messages/2/reactions' },
    ])
  })

  describe('bulkDeleteMessages', () => {
    it('single fresh id uses single delete', async () => {
      const ids = fresh(1)
      const { calls, m } = setup()
      await m.bulkDeleteMessages('1', ids, 'r')
      expect(calls).toEqual([{ verb: 'delete', route: `/channels/1/messages/${ids[0]}`, reason: 'r' }])
    })

    it('250 fresh ids make 3 batches', async () => {
      const ids = fresh(250)
      const { calls, m } = setup()
      await m.bulkDeleteMessages('1', ids, 'r')
      expect(calls.map((c) => [c.verb, c.route, (c.body as { messages: string[] }).messages.length])).toEqual([
        ['post', '/channels/1/messages/bulk-delete', 100],
        ['post', '/channels/1/messages/bulk-delete', 100],
        ['post', '/channels/1/messages/bulk-delete', 50],
      ])
      expect(calls.every((c) => c.reason === 'r')).toBe(true)
    })

    it('trailing batch of one uses single delete', async () => {
      const ids = fresh(101)
      const { calls, m } = setup()
      await m.bulkDeleteMessages('1', ids)
      expect(calls.map((c) => c.verb)).toEqual(['post', 'delete'])
    })

    it('old ids are deleted one by one', async () => {
      const oldIds = old(3)
      const newIds = fresh(2)
      const { calls, m } = setup()
      await m.bulkDeleteMessages('1', [...oldIds, ...newIds], 'r')
      expect(calls).toEqual([
        { verb: 'post', route: '/channels/1/messages/bulk-delete', body: { messages: newIds }, reason: 'r' },
        ...oldIds.map((id) => ({ verb: 'delete', route: `/channels/1/messages/${id}`, reason: 'r' })),
      ])
    })

    it('empty list does nothing', async () => {
      const { calls, m } = setup()
      await m.bulkDeleteMessages('1', [])
      expect(calls).toEqual([])
    })
  })
})
