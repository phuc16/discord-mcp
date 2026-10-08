import { Client, type ClientOptions, GatewayIntentBits, Partials } from 'discord.js'
import type { GatewayPort, GatewayStatus, GatewayStatusInfo, NewEvent } from '../contracts/index.js'
import { normalizeGatewayEvent as norm } from './normalize.js'

type Listener = (...args: unknown[]) => void

export interface GatewayClientLike {
  login(token: string): Promise<unknown>
  destroy(): Promise<void> | void
  on(event: string, listener: Listener): unknown
  off(event: string, listener: Listener): unknown
}

const BASE_INTENTS = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMembers,
  GatewayIntentBits.GuildModeration,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.GuildVoiceStates,
  GatewayIntentBits.GuildScheduledEvents,
]

const PARTIALS = [Partials.Message, Partials.Channel, Partials.GuildMember]

export const gatewayClientOptions = (messageContent: boolean): ClientOptions => ({
  intents: messageContent ? [...BASE_INTENTS, GatewayIntentBits.MessageContent] : BASE_INTENTS,
  partials: PARTIALS,
})

export interface GatewayLogger {
  warn(o: Record<string, unknown>, msg: string): void
  error(o: Record<string, unknown>, msg: string): void
}

const stderrLogger: GatewayLogger = {
  warn: (o, msg) => process.stderr.write(`${JSON.stringify({ level: 'warn', msg, ...o })}\n`),
  error: (o, msg) => process.stderr.write(`${JSON.stringify({ level: 'error', msg, ...o })}\n`),
}

const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e))

const READY_EVENTS = ['clientReady', 'shardReady']
const RESUME_EVENTS = ['shardResume']
const DISCONNECT_EVENTS = ['shardDisconnect']

type Handler = (...args: never[]) => NewEvent | null

const eventHandlers = (messageContent: boolean): Record<string, Handler> => ({
  messageCreate: (m) => norm.message_create(m, messageContent),
  messageUpdate: (o, m) => norm.message_update(o, m, messageContent),
  messageDelete: norm.message_delete,
  guildMemberAdd: norm.member_join,
  guildMemberRemove: norm.member_remove,
  guildMemberUpdate: norm.member_update,
  guildBanAdd: norm.member_ban,
  guildBanRemove: norm.member_unban,
  roleCreate: norm.role_create,
  roleUpdate: norm.role_update,
  roleDelete: norm.role_delete,
  channelCreate: norm.channel_create,
  channelUpdate: norm.channel_update,
  channelDelete: norm.channel_delete,
  voiceStateUpdate: norm.voice_state,
  guildScheduledEventCreate: (e) => norm.scheduled_event('create', e),
  guildScheduledEventUpdate: (_o, e) => norm.scheduled_event('update', e),
  guildScheduledEventDelete: (e) => norm.scheduled_event('delete', e),
})

export const createGateway = (o: { botToken: string; messageContent: boolean; client?: GatewayClientLike; logger?: GatewayLogger }): GatewayPort => {
  const client: GatewayClientLike =
    o.client ??
    (new Client(gatewayClientOptions(o.messageContent)) as unknown as GatewayClientLike)
  const log = o.logger ?? stderrLogger

  let current: GatewayStatus = 'disconnected'
  const eventSubs = new Set<(e: NewEvent) => void>()
  const statusSubs = new Set<(s: GatewayStatus, info?: GatewayStatusInfo) => void>()
  const attached: [string, Listener][] = []

  let disconnectedAt: string | null = null

  const setStatus = (s: GatewayStatus, info?: GatewayStatusInfo) => {
    if (s === current) return
    current = s
    for (const cb of [...statusSubs]) {
      try {
        cb(s, info)
      } catch (err) {
        log.warn({ error: errMsg(err) }, 'gateway status subscriber failed')
      }
    }
  }

  const emit = (e: NewEvent) => {
    for (const cb of [...eventSubs]) {
      try {
        cb(e)
      } catch (err) {
        log.warn({ error: errMsg(err), event_type: e.type }, 'gateway event subscriber failed')
      }
    }
  }

  const attach = (event: string, listener: Listener) => {
    client.on(event, listener)
    attached.push([event, listener])
  }

  const detachAll = () => {
    for (const [event, listener] of attached.splice(0)) client.off(event, listener)
  }

  return {
    async start() {
      detachAll()
      for (const [event, handler] of Object.entries(eventHandlers(o.messageContent))) {
        attach(event, (...args) => {
          try {
            const normalized = (handler as (...a: unknown[]) => NewEvent | null)(...args)
            if (normalized) emit(normalized)
          } catch (err) {
            log.error({ error: errMsg(err), gateway_event: event }, 'gateway listener failed')
          }
        })
      }
      attach('error', (err) => log.error({ error: errMsg(err) }, 'gateway client error'))
      const markReady = (resumed: boolean) => {
        const since = disconnectedAt
        disconnectedAt = null
        setStatus('ready', since ? { disconnectedAt: since, reconnectedAt: new Date().toISOString(), resumed } : undefined)
      }
      for (const event of READY_EVENTS) attach(event, () => markReady(false))
      for (const event of RESUME_EVENTS) attach(event, () => markReady(true))
      for (const event of DISCONNECT_EVENTS) {
        attach(event, () => {
          disconnectedAt ??= new Date().toISOString()
          setStatus('disconnected')
        })
      }
      setStatus('connecting')
      await client.login(o.botToken)
    },
    async stop() {
      detachAll()
      await client.destroy()
      setStatus('disconnected')
    },
    onEvent(cb) {
      eventSubs.add(cb)
      return () => void eventSubs.delete(cb)
    },
    onStatus(cb) {
      statusSubs.add(cb)
      return () => void statusSubs.delete(cb)
    },
    status: () => current,
  }
}
