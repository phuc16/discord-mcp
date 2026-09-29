import { afterEach, describe, expect, it } from 'vitest'
import type { EventType } from '../../src/contracts/index.js'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, call } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async () => {
  const harness = await buildHarness({ config: { safety: { allow_token_confirm: true }, guilds: { [GUILD_A]: { max_tier: 'destructive' } } } })
  h = harness
  const d = harness.discord
  d.seedGuild(GUILD_A, { members: 5 })
  const ch = (await d.createChannel(GUILD_A, { name: 'general', type: 0 })).id
  const forum = (await d.createChannel(GUILD_A, { name: 'forum', type: 15, available_tags: [] })).id
  const wh = await d.createWebhook(ch, { name: 'hook' })
  await harness.gateway.start()
  d.calls.length = 0
  return { harness, ch, forum, wh }
}

const lastCall = (harness: Harness, method: string) => harness.discord.calls.filter((c) => c.method === method).at(-1)

const mentionsOf = (args: unknown[]): unknown => {
  const walk = (v: unknown): unknown => {
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      if ('allowed_mentions' in o) return o.allowed_mentions
      for (const x of Object.values(o)) {
        const found = walk(x)
        if (found !== undefined) return found
      }
    }
    return undefined
  }
  return walk(args)
}

describe('allowed_mentions defaults to no pings', () => {
  it('messages_send', async () => {
    const { harness, ch } = await setup()
    const r = await call(harness.client, 'messages_send', { guild_id: GUILD_A, channel_id: ch, content: '@everyone hi' })
    expect(r.isError, r.text).toBe(false)
    expect(mentionsOf(lastCall(harness, 'sendMessage')!.args)).toEqual({ parse: [] })
  })

  it('messages_edit', async () => {
    const { harness, ch } = await setup()
    const sent = await call(harness.client, 'messages_send', { guild_id: GUILD_A, channel_id: ch, content: 'x' })
    const r = await call(harness.client, 'messages_edit', { guild_id: GUILD_A, channel_id: ch, message_id: sent.body.id, content: '@everyone' })
    expect(r.isError, r.text).toBe(false)
    expect(mentionsOf(lastCall(harness, 'editMessage')!.args)).toEqual({ parse: [] })
  })

  it('forum_create_post', async () => {
    const { harness, forum } = await setup()
    const r = await call(harness.client, 'forum_create_post', { guild_id: GUILD_A, channel_id: forum, name: 'p', content: '@everyone' })
    expect(r.isError, r.text).toBe(false)
    expect(mentionsOf(lastCall(harness, 'createForumPost')!.args)).toEqual({ parse: [] })
  })

  it('webhooks_execute', async () => {
    const { harness, wh } = await setup()
    const r = await call(harness.client, 'webhooks_execute', { guild_id: GUILD_A, webhook_id: wh.id, content: '@everyone' })
    expect(r.isError, r.text).toBe(false)
    expect(mentionsOf(lastCall(harness, 'executeWebhook')!.args)).toEqual({ parse: [] })
  })

  it('everyone is not an accepted parse value, explicit ids are', async () => {
    const { harness, ch } = await setup()
    const bad = await call(harness.client, 'messages_send', { guild_id: GUILD_A, channel_id: ch, content: 'x', allowed_mentions: { parse: ['everyone'] } })
    expect(bad.isError).toBe(true)
    expect(harness.discord.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(0)
    const ok = await call(harness.client, 'messages_send', { guild_id: GUILD_A, channel_id: ch, content: 'x', allowed_mentions: { users: ['700000000000000001'] } })
    expect(ok.isError, ok.text).toBe(false)
    expect(JSON.stringify(mentionsOf(lastCall(harness, 'sendMessage')!.args))).toContain('700000000000000001')
  })
})

describe('messages_purge preview equals execution', () => {
  it('messages arriving between preview and execute are not deleted', async () => {
    const { harness, ch } = await setup()
    const d = harness.discord
    const first: string[] = []
    for (let i = 0; i < 5; i++) first.push((await d.sendMessage(ch, { content: `old ${i}` })).id)
    const before = (BigInt(first.at(-1)!) + 1n).toString()
    const args = { guild_id: GUILD_A, channel_id: ch, limit: 100, before }
    const preview = await call(harness.client, 'messages_purge', args)
    expect(preview.code).toBe('confirm_required')
    expect((preview.details.preview as { affected: { messages: number } }).affected.messages).toBe(5)
    const late = await d.sendMessage(ch, { content: 'arrived after preview' })
    const done = await call(harness.client, 'messages_purge', { ...args, confirm_token: preview.details.confirm_token })
    expect(done.isError, done.text).toBe(false)
    expect((done.body as { deleted?: number }).deleted).toBe(5)
    expect(d.messages.get(ch)!.map((m) => m.id)).toEqual([late.id])
  })

  it('changing before after the preview invalidates the confirmation', async () => {
    const { harness, ch } = await setup()
    const d = harness.discord
    const id = (await d.sendMessage(ch, { content: 'a' })).id
    const late = (await d.sendMessage(ch, { content: 'b' })).id
    const args = { guild_id: GUILD_A, channel_id: ch, limit: 100, before: (BigInt(id) + 1n).toString() }
    const preview = await call(harness.client, 'messages_purge', args)
    const widened = await call(harness.client, 'messages_purge', { ...args, before: (BigInt(late) + 1n).toString(), confirm_token: preview.details.confirm_token })
    expect(widened.code).toBe('confirm_invalid')
    expect(d.messages.get(ch)!).toHaveLength(2)
  })

  it('before is required', async () => {
    const { harness, ch } = await setup()
    const r = await call(harness.client, 'messages_purge', { guild_id: GUILD_A, channel_id: ch, limit: 10 })
    expect(r.isError).toBe(true)
    expect(r.code).not.toBe('confirm_required')
  })

  it('never scans or deletes messages older than 14 days', async () => {
    const { harness, ch } = await setup()
    const d = harness.discord
    const DISCORD_EPOCH = 1_420_070_400_000n
    const snowflakeAt = (ms: number, n: number): string => (((BigInt(ms) - DISCORD_EPOCH) << 22n) | BigInt(n)).toString()
    const old = snowflakeAt(Date.now() - 20 * 86_400_000, 1)
    const recent = snowflakeAt(Date.now() - 60_000, 2)
    d.messages.set(ch, [
      { id: old, channel_id: ch, guild_id: GUILD_A, content: 'ancient', pinned: false, reactions: [], author: { id: 'u' } },
      { id: recent, channel_id: ch, guild_id: GUILD_A, content: 'fresh', pinned: false, reactions: [], author: { id: 'u' } },
    ])
    const args = { guild_id: GUILD_A, channel_id: ch, limit: 100, before: (BigInt(recent) + 1n).toString() }
    const preview = await call(harness.client, 'messages_purge', args)
    const done = await call(harness.client, 'messages_purge', { ...args, confirm_token: preview.details.confirm_token })
    expect(done.isError, done.text).toBe(false)
    expect(d.messages.get(ch)!.map((m) => m.id)).toEqual([old])
  })
})

describe('pagination cursors', () => {
  it('members_list next_cursor is the last member user.id and pages through everyone', async () => {
    const { harness } = await setup()
    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const r = await call(harness.client, 'members_list', { guild_id: GUILD_A, limit: 2, ...(cursor ? { after: cursor } : {}) })
      expect(r.isError, r.text).toBe(false)
      const items = r.body.items as { user: { id: string } }[]
      seen.push(...items.map((m) => m.user.id))
      cursor = r.body.next_cursor as string | undefined
      if (items.length === 2) expect(cursor).toBe(items[1]!.user.id)
      if (!cursor) break
    }
    expect(new Set(seen).size).toBe(5)
    expect(seen).toHaveLength(5)
  })

  it('mod_list_bans returns next_cursor and pages through every ban', async () => {
    const { harness } = await setup()
    for (const id of ['800000000000000003', '800000000000000001', '800000000000000002']) await harness.discord.banMember(GUILD_A, id, {})
    const seen: string[] = []
    let cursor: string | undefined
    for (let page = 0; page < 5; page++) {
      const r = await call(harness.client, 'mod_list_bans', { guild_id: GUILD_A, limit: 2, ...(cursor ? { after: cursor } : {}) })
      expect(r.isError, r.text).toBe(false)
      const items = r.body.items as { user: { id: string } }[]
      seen.push(...items.map((b) => b.user.id))
      cursor = r.body.next_cursor as string | undefined
      if (!cursor) break
    }
    expect(seen).toEqual(['800000000000000001', '800000000000000002', '800000000000000003'])
  })

  it('events_poll next_cursor is numeric like since_id', async () => {
    const { harness } = await setup()
    harness.gateway.emit({ guildId: GUILD_A, type: 'member_join', at: new Date().toISOString(), data: {} })
    const r = await call(harness.client, 'events_poll', { guild_id: GUILD_A })
    expect(typeof r.body.next_cursor).toBe('number')
    const next = await call(harness.client, 'events_poll', { guild_id: GUILD_A, since_id: r.body.next_cursor })
    expect(next.isError, next.text).toBe(false)
  })
})

describe('events', () => {
  const emit = (harness: Harness, type: EventType, n: number) =>
    harness.gateway.emit({ guildId: GUILD_A, type, at: new Date(harness.clock.now()).toISOString(), data: { n } })

  it('a type filter still returns gap markers', async () => {
    const { harness } = await setup()
    emit(harness, 'member_join', 1)
    emit(harness, 'message_create', 2)
    harness.gateway.disconnect()
    harness.gateway.reconnect()
    emit(harness, 'message_create', 3)
    const r = await call(harness.client, 'events_poll', { guild_id: GUILD_A, types: ['member_join'] })
    expect((r.body.items as { type: string }[]).map((e) => e.type)).toEqual(['member_join', 'gap'])
  })

  it('the events resource returns the newest events when there are more than 100', async () => {
    const { harness } = await setup()
    for (let i = 1; i <= 250; i++) emit(harness, 'message_create', i)
    const read = await harness.client.readResource({ uri: `discord://guild/${GUILD_A}/events` })
    const events = JSON.parse((read.contents[0] as { text: string }).text) as { data: { n: number } }[]
    expect(events.length).toBeGreaterThan(0)
    expect(events.at(-1)!.data.n).toBe(250)
    expect(events[0]!.data.n).toBeGreaterThan(1)
    const ns = events.map((e) => e.data.n)
    expect(ns).toEqual([...ns].sort((a, b) => a - b))
  })
})
