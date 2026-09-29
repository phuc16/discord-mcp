import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GatewayPort, GatewayStatus, NewEvent, NormalizedEvent, Principal } from '../../../src/contracts/index.js'
import { createEventsService } from '../../../src/events/index.js'
import { openStore, type Store } from '../../../src/store/index.js'

class FakeGateway implements GatewayPort {
  private current: GatewayStatus = 'disconnected'
  private eventCbs = new Set<(e: NewEvent) => void>()
  private statusCbs = new Set<(s: GatewayStatus) => void>()
  async start() {}
  async stop() {}
  onEvent(cb: (e: NewEvent) => void) {
    this.eventCbs.add(cb)
    return () => void this.eventCbs.delete(cb)
  }
  onStatus(cb: (s: GatewayStatus) => void) {
    this.statusCbs.add(cb)
    return () => void this.statusCbs.delete(cb)
  }
  status() {
    return this.current
  }
  emit(e: NewEvent) {
    for (const cb of [...this.eventCbs]) cb(e)
  }
  setStatus(s: GatewayStatus) {
    this.current = s
    for (const cb of [...this.statusCbs]) cb(s)
  }
  listeners() {
    return this.eventCbs.size + this.statusCbs.size
  }
}

const principal: Principal = { kind: 'stdio', userId: null, userName: 'local', guilds: {} }
const T0 = Date.parse('2026-01-10T00:00:00.000Z')
const HOUR = 3_600_000

const ev = (over: Partial<NewEvent> = {}): NewEvent => ({
  guildId: 'g1',
  type: 'message_create',
  at: new Date(T0).toISOString(),
  data: {},
  ...over,
})

describe('events service', () => {
  let store: Store
  let gateway: FakeGateway
  let clock: number
  let allow: boolean

  const build = (o: { retention?: number; max?: number; guildIds?: string[] } = {}) =>
    createEventsService({
      store,
      gateway,
      config: { events: { retention_hours: o.retention ?? 72, max_buffer: o.max ?? 50000 } },
      guildIds: o.guildIds ?? ['g1', 'g2'],
      canRead: () => allow,
      now: () => clock,
    })

  const all = (guildId = 'g1') => store.events.since({ guildId, sinceId: 0, limit: 100000 })

  beforeEach(() => {
    store = openStore(':memory:')
    gateway = new FakeGateway()
    clock = T0
    allow = true
  })

  afterEach(() => {
    vi.useRealTimers()
    store.close()
  })

  it('stores gateway events in order with monotonic ids', async () => {
    const svc = build()
    svc.start()
    gateway.emit(ev({ data: { n: 1 } }))
    gateway.emit(ev({ data: { n: 2 } }))
    const out = await svc.poll(principal, { guildId: 'g1', sinceId: 0, limit: 10 })
    expect(out.map((e) => e.data.n)).toEqual([1, 2])
    expect(out[1]!.id).toBeGreaterThan(out[0]!.id)
  })

  it('ignores events for guilds outside guildIds', () => {
    const svc = build({ guildIds: ['g1'] })
    svc.start()
    gateway.emit(ev({ guildId: 'other' }))
    expect(all('other')).toEqual([])
  })

  it('poll filters by type and sinceId', async () => {
    const svc = build()
    svc.start()
    gateway.emit(ev({ type: 'message_create' }))
    gateway.emit(ev({ type: 'role_create' }))
    gateway.emit(ev({ type: 'role_create' }))
    const first = await svc.poll(principal, { guildId: 'g1', sinceId: 0, types: ['role_create'], limit: 10 })
    expect(first.map((e) => e.type)).toEqual(['role_create', 'role_create'])
    const rest = await svc.poll(principal, { guildId: 'g1', sinceId: first[0]!.id, limit: 10 })
    expect(rest.map((e) => e.id)).toEqual([first[1]!.id])
  })

  it('poll clamps limit to 1..500', async () => {
    const svc = build()
    svc.start()
    for (let i = 0; i < 3; i++) gateway.emit(ev())
    expect(await svc.poll(principal, { guildId: 'g1', sinceId: 0, limit: 0 })).toHaveLength(1)
    expect(await svc.poll(principal, { guildId: 'g1', sinceId: 0, limit: -5 })).toHaveLength(1)
    const spy = vi.spyOn(store.events, 'since')
    await svc.poll(principal, { guildId: 'g1', sinceId: 0, limit: 9999 })
    expect(spy.mock.calls[0]![0].limit).toBe(500)
  })

  it('poll is denied when canRead is false', async () => {
    const svc = build()
    allow = false
    await expect(svc.poll(principal, { guildId: 'g1', sinceId: 0, limit: 10 })).rejects.toMatchObject({
      code: 'guild_not_allowed',
    })
  })

  it('appends a gap event per guild after reconnect', () => {
    const svc = build()
    svc.start()
    gateway.setStatus('connecting')
    gateway.setStatus('ready')
    expect(all('g1')).toEqual([])
    gateway.setStatus('disconnected')
    gateway.setStatus('ready')
    expect(all('g1').map((e) => e.type)).toEqual(['gap'])
    expect(all('g2').map((e) => e.type)).toEqual(['gap'])
  })

  it('does not append a gap on first ready', () => {
    const svc = build()
    svc.start()
    gateway.setStatus('ready')
    expect(all('g1')).toEqual([])
  })

  it('notifies subscribers with stored events and supports unsubscribe', () => {
    const svc = build()
    const got: NormalizedEvent[] = []
    const off = svc.subscribe((e) => got.push(e))
    svc.start()
    gateway.emit(ev({ data: { n: 1 } }))
    off()
    gateway.emit(ev({ data: { n: 2 } }))
    expect(got).toHaveLength(1)
    expect(got[0]!.id).toBeGreaterThan(0)
    expect(got[0]!.data.n).toBe(1)
  })

  it('subscriber errors do not break storage', () => {
    const svc = build()
    svc.subscribe(() => {
      throw new Error('boom')
    })
    svc.start()
    expect(() => gateway.emit(ev())).not.toThrow()
    expect(all()).toHaveLength(1)
  })

  it('prunes by age every 10 minutes', () => {
    vi.useFakeTimers()
    const svc = build({ retention: 1 })
    svc.start()
    gateway.emit(ev({ at: new Date(T0 - 2 * HOUR).toISOString() }))
    gateway.emit(ev({ at: new Date(T0).toISOString() }))
    expect(all()).toHaveLength(2)
    vi.advanceTimersByTime(10 * 60_000)
    expect(all()).toHaveLength(1)
  })

  it('prunes by max rows after 1000 appends', () => {
    const svc = build({ max: 10 })
    svc.start()
    for (let i = 0; i < 999; i++) gateway.emit(ev())
    expect(all()).toHaveLength(999)
    gateway.emit(ev())
    expect(all()).toHaveLength(10)
  })

  it('recent returns the newest events ascending', () => {
    const svc = build()
    svc.start()
    for (let i = 1; i <= 5; i++) gateway.emit(ev({ data: { n: i } }))
    gateway.emit(ev({ guildId: 'g2', data: { n: 99 } }))
    expect(svc.recent('g1', 3).map((e) => e.data.n)).toEqual([3, 4, 5])
  })

  it('recent returns the newest events when the guild has more than 100', () => {
    const svc = build()
    svc.start()
    for (let i = 1; i <= 150; i++) gateway.emit(ev({ data: { n: i } }))
    const got = svc.recent('g1', 100).map((e) => e.data.n)
    expect(got).toHaveLength(100)
    expect(got[0]).toBe(51)
    expect(got.at(-1)).toBe(150)
  })

  it('logs swallowed subscriber errors at warn', () => {
    const warns: string[] = []
    const svc = createEventsService({
      store,
      gateway,
      config: { events: { retention_hours: 72, max_buffer: 50000 } },
      guildIds: ['g1'],
      canRead: () => true,
      now: () => clock,
      logger: { warn: (_o, msg) => warns.push(msg) },
    })
    svc.subscribe(() => {
      throw new Error('boom')
    })
    svc.start()
    gateway.emit(ev())
    expect(warns).toHaveLength(1)
    expect(all()).toHaveLength(1)
  })

  it('stop is idempotent, unsubscribes and halts pruning', () => {
    vi.useFakeTimers()
    const svc = build({ retention: 1 })
    svc.start()
    svc.stop()
    svc.stop()
    expect(gateway.listeners()).toBe(0)
    gateway.emit(ev())
    expect(all()).toEqual([])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('start is idempotent', () => {
    const svc = build()
    svc.start()
    svc.start()
    gateway.emit(ev())
    expect(all()).toHaveLength(1)
  })
})
