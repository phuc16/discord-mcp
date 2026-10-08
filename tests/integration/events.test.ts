import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import type { EventType } from '../../src/contracts/index.js'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B, GUILD_C, call, principals } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async (events?: { retention_hours?: number; max_buffer?: number }) => {
  const harness = await buildHarness({
    config: {
      guilds: { [GUILD_A]: { max_tier: 'destructive' }, [GUILD_B]: { max_tier: 'write' } },
      ...(events ? { events: { retention_hours: 72, max_buffer: 50000, ...events } } : {}),
    },
  })
  h = harness
  harness.discord.seedGuild(GUILD_A)
  harness.discord.seedGuild(GUILD_B)
  harness.gateway.setStatus('ready')
  return harness
}

const emit = (harness: Harness, guildId: string, type: EventType, data: Record<string, unknown> = {}) =>
  harness.gateway.emit({ guildId, type, at: new Date(harness.clock.now()).toISOString(), data })

const poll = async (harness: Harness, args: Record<string, unknown>, client = harness.client) =>
  call(client, 'events_poll', { guild_id: GUILD_A, ...args })

const items = (r: { body: Record<string, unknown> }): { id: number; type: string; data: Record<string, unknown> }[] =>
  (r.body.items ?? []) as { id: number; type: string; data: Record<string, unknown> }[]

describe('events_poll', () => {
  it('returns events in ascending id order with a cursor', async () => {
    const harness = await setup()
    emit(harness, GUILD_A, 'member_join', { n: 1 })
    emit(harness, GUILD_A, 'message_create', { n: 2 })
    emit(harness, GUILD_A, 'member_remove', { n: 3 })
    const r = await poll(harness, {})
    const got = items(r)
    expect(got.map((e) => e.data.n)).toEqual([1, 2, 3])
    expect(got.map((e) => e.id)).toEqual([...got.map((e) => e.id)].sort((a, b) => a - b))
    expect(r.body.next_cursor).toBe(got[2]!.id)
  })

  it('filters by type', async () => {
    const harness = await setup()
    emit(harness, GUILD_A, 'member_join')
    emit(harness, GUILD_A, 'message_create')
    emit(harness, GUILD_A, 'member_join')
    const r = await poll(harness, { types: ['member_join'] })
    expect(items(r).map((e) => e.type)).toEqual(['member_join', 'member_join'])
  })

  it('resumes after since_id and is empty at the head', async () => {
    const harness = await setup()
    emit(harness, GUILD_A, 'member_join', { n: 1 })
    emit(harness, GUILD_A, 'member_join', { n: 2 })
    const first = items(await poll(harness, {}))
    const rest = items(await poll(harness, { since_id: first[0]!.id }))
    expect(rest.map((e) => e.data.n)).toEqual([2])
    expect(items(await poll(harness, { since_id: first[1]!.id }))).toEqual([])
  })

  it('honours limit', async () => {
    const harness = await setup()
    for (let i = 0; i < 5; i++) emit(harness, GUILD_A, 'member_join', { n: i })
    expect(items(await poll(harness, { limit: 2 })).map((e) => e.data.n)).toEqual([0, 1])
  })

  it('isolates guilds and drops events of non-allowlisted guilds', async () => {
    const harness = await setup()
    emit(harness, GUILD_A, 'member_join', { g: 'a' })
    emit(harness, GUILD_B, 'member_join', { g: 'b' })
    emit(harness, GUILD_C, 'member_join', { g: 'c' })
    expect(items(await poll(harness, {})).map((e) => e.data.g)).toEqual(['a'])
    expect(items(await poll(harness, { guild_id: GUILD_B })).map((e) => e.data.g)).toEqual(['b'])
    const c = await poll(harness, { guild_id: GUILD_C })
    expect(c.code).toBe('guild_not_allowed')
  })

  it('prunes to max_buffer', async () => {
    const harness = await setup({ max_buffer: 10 })
    for (let i = 0; i < 1000; i++) emit(harness, GUILD_A, 'message_create', { n: i })
    const got = items(await poll(harness, { limit: 500 }))
    expect(got.length).toBeLessThanOrEqual(10)
    expect(got.at(-1)!.data.n).toBe(999)
  })

  it('marks a gap after disconnect and reconnect', async () => {
    const harness = await setup()
    emit(harness, GUILD_A, 'member_join')
    harness.gateway.setStatus('disconnected')
    harness.gateway.setStatus('ready')
    const types = items(await poll(harness, {})).map((e) => e.type)
    expect(types).toEqual(['member_join', 'gap'])
    expect(items(await poll(harness, { guild_id: GUILD_B })).map((e) => e.type)).toEqual(['gap'])
  })

  it('does not emit a gap when the gateway was never ready before', async () => {
    const harness = await buildHarness({ config: { guilds: { [GUILD_A]: { max_tier: 'read' } } } })
    h = harness
    harness.gateway.setStatus('disconnected')
    harness.gateway.setStatus('ready')
    expect(items(await poll(harness, {}))).toEqual([])
  })

  it('denies a user principal without access to the guild', async () => {
    const harness = await setup()
    const outsider = await harness.asPrincipal(principals.notInGuild)
    const r = await poll(harness, {}, outsider)
    expect(r.code).toBe('guild_not_allowed')
    const otherGuildUser = await harness.asPrincipal({ kind: 'user', userId: '30', userName: 'b-only', guilds: { [GUILD_B]: '8' } })
    expect((await poll(harness, {}, otherGuildUser)).code).toBe('guild_not_allowed')
    expect((await poll(harness, { guild_id: GUILD_B }, otherGuildUser)).isError).toBe(false)
  })
})

describe('events resource subscription', () => {
  const uri = (g: string) => `discord://guild/${g}/events`

  it('lists the resource per readable guild and reads recent events', async () => {
    const harness = await setup()
    emit(harness, GUILD_A, 'member_join', { n: 1 })
    const list = await harness.client.listResources()
    expect(list.resources.map((r) => r.uri).sort()).toEqual([uri(GUILD_A), uri(GUILD_B)].sort())
    const read = await harness.client.readResource({ uri: uri(GUILD_A) })
    const text = (read.contents[0] as { text: string }).text
    expect((JSON.parse(text) as { data: { n: number } }[]).map((e) => e.data.n)).toEqual([1])
  })

  it('delivers resources/updated for a new event and stops after unsubscribe', async () => {
    const harness = await setup()
    const seen: string[] = []
    harness.client.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      seen.push(n.params.uri)
    })
    await harness.client.subscribeResource({ uri: uri(GUILD_A) })
    emit(harness, GUILD_A, 'member_join')
    await expect.poll(() => seen).toEqual([uri(GUILD_A)])
    emit(harness, GUILD_B, 'member_join')
    await harness.client.unsubscribeResource({ uri: uri(GUILD_A) })
    emit(harness, GUILD_A, 'member_join')
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual([uri(GUILD_A)])
  })

  it('refuses subscription to a guild the principal cannot read', async () => {
    const harness = await setup()
    const outsider = await harness.asPrincipal(principals.notInGuild)
    await expect(outsider.subscribeResource({ uri: uri(GUILD_A) })).rejects.toThrow()
    await expect(outsider.readResource({ uri: uri(GUILD_A) })).rejects.toThrow()
    await expect(harness.client.subscribeResource({ uri: uri(GUILD_C) })).rejects.toThrow()
  })

  it('does not notify a subscriber whose access was revoked mid-session', async () => {
    const harness = await setup()
    const guilds: Record<string, string> = { [GUILD_A]: '8' }
    const user = await harness.asPrincipal({ kind: 'user', userId: '40', userName: 'rev', guilds })
    const seen: string[] = []
    user.setNotificationHandler(ResourceUpdatedNotificationSchema, (n) => {
      seen.push(n.params.uri)
    })
    await user.subscribeResource({ uri: uri(GUILD_A) })
    delete guilds[GUILD_A]
    emit(harness, GUILD_A, 'member_join')
    await new Promise((r) => setTimeout(r, 50))
    expect(seen).toEqual([])
  })
})
