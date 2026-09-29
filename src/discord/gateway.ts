import { Client, GatewayIntentBits } from 'discord.js'
import type { GatewayPort, GatewayStatus, NewEvent } from '../contracts/index.js'
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

const READY_EVENTS = ['clientReady', 'ready', 'shardResume']
const DISCONNECT_EVENTS = ['shardDisconnect']

type Handler = (...args: never[]) => NewEvent | null

const eventHandlers = (messageContent: boolean): Record<string, Handler> => ({
  messageCreate: (m) => norm.message_create(m, messageContent),
  messageUpdate: (o, m) => norm.message_update(o, m, messageContent),
  messageDelete: norm.message_delete,
  guildMemberAdd: norm.member_join,
  guildMemberRemove: norm.member_remove,
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

export const createGateway = (o: { botToken: string; messageContent: boolean; client?: GatewayClientLike }): GatewayPort => {
  const client: GatewayClientLike =
    o.client ??
    (new Client({
      intents: o.messageContent ? [...BASE_INTENTS, GatewayIntentBits.MessageContent] : BASE_INTENTS,
    }) as unknown as GatewayClientLike)

  let current: GatewayStatus = 'disconnected'
  const eventSubs = new Set<(e: NewEvent) => void>()
  const statusSubs = new Set<(s: GatewayStatus) => void>()
  const attached: [string, Listener][] = []

  const setStatus = (s: GatewayStatus) => {
    if (s === current) return
    current = s
    for (const cb of [...statusSubs]) cb(s)
  }

  const emit = (e: NewEvent) => {
    for (const cb of [...eventSubs]) {
      try {
        cb(e)
      } catch {
        continue
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
          const normalized = (handler as (...a: unknown[]) => NewEvent | null)(...args)
          if (normalized) emit(normalized)
        })
      }
      for (const event of READY_EVENTS) attach(event, () => setStatus('ready'))
      for (const event of DISCONNECT_EVENTS) attach(event, () => setStatus('disconnected'))
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
