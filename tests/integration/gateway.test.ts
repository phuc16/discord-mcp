import { Partials } from 'discord.js'
import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../../src/contracts/index.js'
import type { NewEvent } from '../../src/contracts/index.js'
import { createGateway, gatewayClientOptions } from '../../src/discord/gateway.js'
import { createEventsService } from '../../src/events/index.js'
import { openStore } from '../../src/store/index.js'
import { FakeGatewayClient } from '../fakes/fake-gateway-client.js'
import type { PartialKind } from '../fakes/fake-gateway-client.js'

const G = '100000000000000001'

const configuredPartials = (): PartialKind[] => {
  const wanted: Record<PartialKind, number> = { Message: Partials.Message, Channel: Partials.Channel, GuildMember: Partials.GuildMember }
  const list = (gatewayClientOptions(false).partials ?? []) as number[]
  return (Object.keys(wanted) as PartialKind[]).filter((n) => list.includes(wanted[n]))
}

const build = (partials: PartialKind[] = configuredPartials()) => {
  const client = new FakeGatewayClient(partials)
  const warnings: string[] = []
  const gateway = createGateway({ botToken: 't', messageContent: true, client, logger: { warn: (_o, m) => void warnings.push(m), error: (_o, m) => void warnings.push(m) } })
  const events: NewEvent[] = []
  gateway.onEvent((e) => events.push(e))
  return { client, gateway, events, warnings }
}

describe('gateway client is configured for partial objects', () => {
  it('requests Message, Channel and GuildMember partials', () => {
    expect(configuredPartials()).toEqual(['Message', 'Channel', 'GuildMember'])
  })

  it('a client without those partials would silently drop the events (why they matter)', async () => {
    const { client, gateway } = build([])
    await gateway.start()
    expect(client.messageDeleted({ id: '1', channelId: '2', guildId: G })).toBe(false)
    expect(client.memberRemoved({ id: '9', guildId: G })).toBe(false)
  })

  it('message_delete fires for an uncached message', async () => {
    const { client, gateway, events } = build()
    await gateway.start()
    expect(client.messageDeleted({ id: '700', channelId: '800', guildId: G })).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ guildId: G, type: 'message_delete', data: { message_id: '700', channel_id: '800' } })
  })

  it('message_update fires for an uncached old message and never leaks content when the intent is off', async () => {
    const client = new FakeGatewayClient(configuredPartials())
    const gateway = createGateway({ botToken: 't', messageContent: false, client })
    const events: NewEvent[] = []
    gateway.onEvent((e) => events.push(e))
    await gateway.start()
    client.messageEdited({ id: '700', channelId: '800', guildId: G, content: 'secret', author: { id: '5' } })
    expect(events.map((e) => e.type)).toEqual(['message_update'])
    expect(events[0]!.data).not.toHaveProperty('content')
    expect(JSON.stringify(events[0])).not.toContain('secret')
  })

  it('member_remove fires for an uncached member', async () => {
    const { client, gateway, events } = build()
    await gateway.start()
    expect(client.memberRemoved({ id: '9', guildId: G, username: 'gone' })).toBe(true)
    expect(events[0]).toMatchObject({ guildId: G, type: 'member_remove', data: { user_id: '9' } })
  })

  it('member_update fires only when roles changed, with old and new roles', async () => {
    const { client, gateway, events } = build()
    await gateway.start()
    client.cacheMember({ id: '9', guildId: G, username: 'u', roles: ['1', '2'] })
    client.memberUpdated({ id: '9', guildId: G, username: 'u', roles: ['1', '2'] })
    expect(events).toEqual([])
    client.memberUpdated({ id: '9', guildId: G, username: 'u', roles: ['1'] })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'member_update', data: { user_id: '9', old_roles: ['1', '2'], new_roles: ['1'] } })
  })

  it('member_update fires for an uncached old member', async () => {
    const { client, gateway, events } = build()
    await gateway.start()
    client.memberUpdated({ id: '9', guildId: G, username: 'u', roles: ['1'] })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'member_update', data: { user_id: '9', new_roles: ['1'] } })
  })

  it('a listener that throws is contained and logged; the next event still flows', async () => {
    const { client, gateway, events, warnings } = build()
    await gateway.start()
    client.emit('guildBanAdd', null)
    client.messageDeleted({ id: '1', channelId: '2', guildId: G })
    expect(events.map((e) => e.type)).toEqual(['message_delete'])
    expect(warnings.length).toBeGreaterThan(0)
  })

  it('a subscriber that throws does not stop delivery to others and is logged', async () => {
    const { client, gateway, events, warnings } = build()
    gateway.onEvent(() => {
      throw new Error('subscriber boom')
    })
    await gateway.start()
    client.messageDeleted({ id: '1', channelId: '2', guildId: G })
    expect(events).toHaveLength(1)
    expect(warnings).toContain('gateway event subscriber failed')
  })

  it('a client error event is logged, not thrown', async () => {
    const { client, gateway, warnings } = build()
    await gateway.start()
    expect(() => client.emit('error', new Error('socket exploded'))).not.toThrow()
    expect(warnings.length).toBeGreaterThan(0)
  })
})

describe('gateway status and gap markers end to end', () => {
  const wire = async () => {
    const { client, gateway } = build()
    const store = openStore(':memory:')
    const events = createEventsService({
      store,
      gateway,
      config: ConfigSchema.parse({ guilds: { [G]: { max_tier: 'read' } } }),
      guildIds: [G],
      canRead: () => true,
    })
    events.start()
    await gateway.start()
    const gaps = () => store.events.since({ guildId: G, sinceId: 0, limit: 100 }).filter((e) => e.type === 'gap')
    return { client, gateway, events, store, gaps }
  }

  it('ready is reached through shardReady alone and does not create a gap', async () => {
    const { client, gateway, gaps } = await wire()
    client.shardReady()
    expect(gateway.status()).toBe('ready')
    client.ready()
    expect(gaps()).toEqual([])
  })

  it('shardResume after a disconnect restores ready without a gap', async () => {
    const { client, gateway, gaps } = await wire()
    client.ready()
    client.shardDisconnect()
    expect(gateway.status()).toBe('disconnected')
    client.shardResume()
    expect(gateway.status()).toBe('ready')
    expect(gaps()).toEqual([])
  })

  it('a fresh ready after a disconnect creates one gap carrying disconnected_at and reconnected_at', async () => {
    const { client, gaps } = await wire()
    client.ready()
    client.shardDisconnect()
    await new Promise((r) => setTimeout(r, 15))
    client.shardReady()
    const list = gaps()
    expect(list).toHaveLength(1)
    const { disconnected_at: from, reconnected_at: to } = list[0]!.data as { disconnected_at: string; reconnected_at: string }
    expect(Date.parse(from)).not.toBeNaN()
    expect(Date.parse(to)).not.toBeNaN()
    expect(Date.parse(to)).toBeGreaterThan(Date.parse(from))
  })

  it('the very first ready is never a gap', async () => {
    const { client, gaps } = await wire()
    client.shardReady()
    client.ready()
    expect(gaps()).toEqual([])
  })
})
