import {
  type Config,
  type EventsPort,
  type GatewayPort,
  type GatewayStatus,
  McpToolError,
  type NewEvent,
  type NormalizedEvent,
  type Principal,
} from '../contracts/index.js'
import type { Store } from '../store/index.js'

export interface EventsService extends EventsPort {
  start(): void
  stop(): void
  subscribe(cb: (e: NormalizedEvent) => void): () => void
  recent(guildId: string, limit: number): NormalizedEvent[]
}

const PRUNE_INTERVAL_MS = 10 * 60_000
const PRUNE_EVERY_APPENDS = 1000
const HOUR_MS = 3_600_000
const MIN_LIMIT = 1
const MAX_LIMIT = 500

const clamp = (n: number): number => Math.min(MAX_LIMIT, Math.max(MIN_LIMIT, Math.trunc(n)))

export const createEventsService = (d: {
  store: Store
  gateway: GatewayPort
  config: Pick<Config, 'events'>
  guildIds: string[]
  canRead: (p: Principal, guildId: string) => boolean
  now?: () => number
  logger?: { warn(o: Record<string, unknown>, msg: string): void }
}): EventsService => {
  const now = d.now ?? Date.now
  const guilds = new Set(d.guildIds)
  const subscribers = new Set<(e: NormalizedEvent) => void>()
  let unsubscribers: (() => void)[] = []
  let timer: NodeJS.Timeout | null = null
  let appendsSincePrune = 0
  let lastStatus: GatewayStatus = 'disconnected'
  let hasBeenReady = false

  const prune = () => {
    appendsSincePrune = 0
    d.store.events.prune({
      olderThanIso: new Date(now() - d.config.events.retention_hours * HOUR_MS).toISOString(),
      maxRows: d.config.events.max_buffer,
    })
  }

  const record = (e: NewEvent) => {
    const stored = d.store.events.append(e)
    for (const cb of [...subscribers]) {
      try {
        cb(stored)
      } catch (err) {
        d.logger?.warn({ error: err instanceof Error ? err.message : String(err), event_type: e.type }, 'event subscriber failed')
      }
    }
    if (++appendsSincePrune >= PRUNE_EVERY_APPENDS) prune()
  }

  const onStatus = (s: GatewayStatus) => {
    const reconnected = s === 'ready' && lastStatus === 'disconnected' && hasBeenReady
    lastStatus = s
    if (s === 'ready') hasBeenReady = true
    if (!reconnected) return
    const at = new Date(now()).toISOString()
    for (const guildId of d.guildIds) record({ guildId, type: 'gap', at, data: {} })
  }

  return {
    start() {
      if (unsubscribers.length > 0) return
      lastStatus = d.gateway.status()
      hasBeenReady = lastStatus === 'ready'
      unsubscribers = [
        d.gateway.onEvent((e) => {
          if (guilds.has(e.guildId)) record(e)
        }),
        d.gateway.onStatus(onStatus),
      ]
      timer = setInterval(prune, PRUNE_INTERVAL_MS)
      timer.unref()
    },

    stop() {
      for (const off of unsubscribers) off()
      unsubscribers = []
      if (timer) clearInterval(timer)
      timer = null
    },

    subscribe(cb) {
      subscribers.add(cb)
      return () => void subscribers.delete(cb)
    },

    recent(guildId, limit) {
      return d.store.events.recent(guildId, Math.max(0, limit))
    },

    async poll(principal, q) {
      if (!d.canRead(principal, q.guildId)) {
        throw new McpToolError('guild_not_allowed', 'guild is not accessible')
      }
      return d.store.events.since({
        guildId: q.guildId,
        sinceId: q.sinceId,
        limit: clamp(q.limit),
        ...(q.types ? { types: q.types } : {}),
      })
    },
  }
}
