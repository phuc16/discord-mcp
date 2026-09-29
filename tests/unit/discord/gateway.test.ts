import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import type { GatewayStatus, NewEvent } from '../../../src/contracts/index.js'
import { createGateway, gatewayClientOptions } from '../../../src/discord/gateway.js'
import { Partials } from 'discord.js'

class FakeClient extends EventEmitter {
  loggedIn: string | null = null
  destroyed = false
  async login(token: string) {
    this.loggedIn = token
    return token
  }
  async destroy() {
    this.destroyed = true
  }
}

const setup = (messageContent = false) => {
  const client = new FakeClient()
  const logs: { level: string; msg: string }[] = []
  const logger = {
    warn: (_o: unknown, msg: string) => logs.push({ level: 'warn', msg }),
    error: (_o: unknown, msg: string) => logs.push({ level: 'error', msg }),
  }
  const gateway = createGateway({ botToken: 'tok', messageContent, client, logger })
  const events: NewEvent[] = []
  const statuses: GatewayStatus[] = []
  gateway.onEvent((e) => events.push(e))
  gateway.onStatus((s) => statuses.push(s))
  return { client, gateway, events, statuses, logs }
}

describe('createGateway', () => {
  it('logs in and reports status transitions', async () => {
    const { client, gateway, statuses } = setup()
    expect(gateway.status()).toBe('disconnected')
    await gateway.start()
    expect(client.loggedIn).toBe('tok')
    client.emit('ready')
    client.emit('shardDisconnect')
    client.emit('shardResume')
    expect(statuses).toEqual(['connecting', 'ready', 'disconnected', 'ready'])
    expect(gateway.status()).toBe('ready')
  })

  it('does not repeat identical statuses', async () => {
    const { client, gateway, statuses } = setup()
    await gateway.start()
    client.emit('ready')
    client.emit('clientReady')
    expect(statuses).toEqual(['connecting', 'ready'])
  })

  it('emits normalized events', async () => {
    const { client, gateway, events } = setup(true)
    await gateway.start()
    client.emit('messageCreate', { id: 'm', channelId: 'c', guildId: 'g', content: 'hi', author: { id: 'u', bot: false } })
    client.emit('guildBanAdd', { guild: { id: 'g' }, user: { id: 'u', username: 'a' } })
    client.emit('roleUpdate', { id: 'r', name: 'o', guild: { id: 'g' } }, { id: 'r', name: 'n', guild: { id: 'g' } })
    client.emit('guildScheduledEventDelete', { id: 'e', name: 'n', guildId: 'g' })
    expect(events.map((e) => e.type)).toEqual(['message_create', 'member_ban', 'role_update', 'scheduled_event'])
    expect(events[0]?.data.content).toBe('hi')
    expect(events[2]?.data.name).toBe('n')
    expect(events[3]?.data.action).toBe('delete')
  })

  it('omits content when intent flag off', async () => {
    const { client, gateway, events } = setup(false)
    await gateway.start()
    client.emit('messageCreate', { id: 'm', channelId: 'c', guildId: 'g', content: 'hi' })
    expect('content' in (events[0]?.data ?? {})).toBe(false)
  })

  it('drops events that normalize to null', async () => {
    const { client, gateway, events } = setup()
    await gateway.start()
    client.emit('channelCreate', { id: 'c', type: 1 })
    expect(events).toEqual([])
  })

  it('handler errors do not escape', async () => {
    const { client, gateway } = setup()
    gateway.onEvent(() => {
      throw new Error('boom')
    })
    await gateway.start()
    expect(() => client.emit('roleDelete', { id: 'r', name: 'n', guild: { id: 'g' } })).not.toThrow()
  })

  it('unsubscribe stops callbacks', async () => {
    const { client, gateway } = setup()
    const got: NewEvent[] = []
    const off = gateway.onEvent((e) => got.push(e))
    await gateway.start()
    off()
    client.emit('roleDelete', { id: 'r', name: 'n', guild: { id: 'g' } })
    expect(got).toEqual([])
  })

  it('stop destroys the client and removes listeners', async () => {
    const { client, gateway, events, statuses } = setup()
    await gateway.start()
    await gateway.stop()
    expect(client.destroyed).toBe(true)
    expect(gateway.status()).toBe('disconnected')
    expect(statuses.at(-1)).toBe('disconnected')
    client.emit('roleDelete', { id: 'r', name: 'n', guild: { id: 'g' } })
    expect(events).toEqual([])
    expect(client.listenerCount('roleDelete')).toBe(0)
  })

  it('client options enable partials for uncached objects', () => {
    const opts = gatewayClientOptions(false)
    expect(opts.partials).toEqual(expect.arrayContaining([Partials.Message, Partials.Channel, Partials.GuildMember]))
  })

  it('emits deletes and removals from partial fixtures', async () => {
    const { client, gateway, events } = setup(true)
    await gateway.start()
    client.emit('messageDelete', { id: 'm', channelId: 'c', guildId: 'g', partial: true })
    client.emit('messageUpdate', { id: 'm', channelId: 'c', guildId: 'g', partial: true }, { id: 'm', channelId: 'c', guildId: 'g', partial: true })
    client.emit('guildMemberRemove', { guild: { id: 'g' }, id: 'u', partial: true, user: { id: 'u' } })
    expect(events.map((e) => e.type)).toEqual(['message_delete', 'message_update', 'member_remove'])
    expect(events[2]?.data).toMatchObject({ user_id: 'u', roles: [] })
  })

  it('shardReady marks the gateway ready', async () => {
    const { client, gateway } = setup()
    await gateway.start()
    client.emit('shardReady', 0)
    expect(gateway.status()).toBe('ready')
  })

  it('normalizer throwing is logged and does not escape', async () => {
    const { client, gateway, logs } = setup()
    await gateway.start()
    expect(() => client.emit('roleDelete', null)).not.toThrow()
    expect(logs.some((l) => l.level === 'error')).toBe(true)
  })

  it('registers a client error listener that logs', async () => {
    const { client, gateway, logs } = setup()
    await gateway.start()
    expect(() => client.emit('error', new Error('ws'))).not.toThrow()
    expect(logs.some((l) => l.level === 'error')).toBe(true)
  })

  it('logs swallowed subscriber errors at warn', async () => {
    const { client, gateway, logs } = setup()
    gateway.onEvent(() => {
      throw new Error('boom')
    })
    await gateway.start()
    client.emit('roleDelete', { id: 'r', name: 'n', guild: { id: 'g' } })
    expect(logs.some((l) => l.level === 'warn')).toBe(true)
  })

  it('status subscriber errors do not break the listener', async () => {
    const { client, gateway, logs } = setup()
    gateway.onStatus(() => {
      throw new Error('boom')
    })
    await gateway.start()
    expect(() => client.emit('ready')).not.toThrow()
    expect(logs.length).toBeGreaterThan(0)
  })
})
