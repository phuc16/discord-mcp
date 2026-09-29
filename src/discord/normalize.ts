import type { EventType, NewEvent } from '../contracts/index.js'

interface GuildRef { id: string }
interface UserLike { id?: string; username?: string | null; bot?: boolean; createdAt?: Date | null }
interface MessageLike {
  id: string
  channelId: string
  guildId?: string | null
  content?: string | null
  author?: UserLike | null
  attachments?: { size: number } | null
}
interface MemberLike { guild: GuildRef; id: string; partial?: boolean; user?: UserLike | null; roles?: { cache: Map<string, unknown> } | null }
interface BanLike { guild: GuildRef; user: UserLike }
interface RoleLike { id: string; name: string; guild: GuildRef }
interface ChannelLike { id: string; name?: string | null; type: number; guildId?: string | null }
interface VoiceLike { guild: GuildRef; id: string; channelId: string | null }
interface ScheduledEventLike { id: string; name: string; guildId: string }
type ScheduledAction = 'create' | 'update' | 'delete'

const build = (guildId: string, type: EventType, data: Record<string, unknown>): NewEvent => ({
  guildId,
  type,
  at: new Date().toISOString(),
  data,
})

const messageEvent = (type: 'message_create' | 'message_update', m: MessageLike, messageContent: boolean): NewEvent | null => {
  if (!m.guildId) return null
  const data: Record<string, unknown> = {
    message_id: m.id,
    channel_id: m.channelId,
    author_id: m.author?.id ?? null,
    author_is_bot: m.author?.bot ?? false,
    attachments_count: m.attachments?.size ?? 0,
  }
  if (messageContent && m.content !== undefined && m.content !== null) data.content = m.content
  return build(m.guildId, type, data)
}

const roleIds = (m: MemberLike): string[] => [...(m.roles?.cache.keys() ?? [])]

const sameRoles = (a: string[], b: string[]): boolean => a.length === b.length && new Set([...a, ...b]).size === a.length

const channelEvent = (type: 'channel_create' | 'channel_update' | 'channel_delete', c: ChannelLike): NewEvent | null =>
  c.guildId ? build(c.guildId, type, { channel_id: c.id, name: c.name ?? null, type: c.type }) : null

const roleEvent = (type: 'role_create' | 'role_update' | 'role_delete', r: RoleLike): NewEvent =>
  build(r.guild.id, type, { role_id: r.id, name: r.name })

const banEvent = (type: 'member_ban' | 'member_unban', b: BanLike): NewEvent =>
  build(b.guild.id, type, { user_id: b.user.id ?? null, username: b.user.username ?? null })

export const normalizeGatewayEvent = {
  message_create: (m: MessageLike, messageContent: boolean) => messageEvent('message_create', m, messageContent),
  message_update: (_old: unknown, m: MessageLike, messageContent: boolean) => messageEvent('message_update', m, messageContent),
  message_delete: (m: MessageLike): NewEvent | null =>
    m.guildId ? build(m.guildId, 'message_delete', { message_id: m.id, channel_id: m.channelId }) : null,

  member_join: (m: MemberLike): NewEvent =>
    build(m.guild.id, 'member_join', {
      user_id: m.id,
      username: m.user?.username ?? null,
      account_created_at: m.user?.createdAt?.toISOString() ?? null,
      roles: roleIds(m),
    }),
  member_remove: (m: MemberLike): NewEvent =>
    build(m.guild.id, 'member_remove', { user_id: m.id, username: m.user?.username ?? null, roles: roleIds(m) }),
  member_update: (oldMember: MemberLike, m: MemberLike): NewEvent | null => {
    const oldRoles = roleIds(oldMember)
    const newRoles = roleIds(m)
    if (oldMember.roles && sameRoles(oldRoles, newRoles)) return null
    return build(m.guild.id, 'member_update', {
      user_id: m.id,
      username: m.user?.username ?? oldMember.user?.username ?? null,
      old_roles: oldRoles,
      new_roles: newRoles,
    })
  },
  member_ban: (b: BanLike) => banEvent('member_ban', b),
  member_unban: (b: BanLike) => banEvent('member_unban', b),

  role_create: (r: RoleLike) => roleEvent('role_create', r),
  role_update: (_old: unknown, r: RoleLike) => roleEvent('role_update', r),
  role_delete: (r: RoleLike) => roleEvent('role_delete', r),

  channel_create: (c: ChannelLike) => channelEvent('channel_create', c),
  channel_update: (_old: unknown, c: ChannelLike) => channelEvent('channel_update', c),
  channel_delete: (c: ChannelLike) => channelEvent('channel_delete', c),

  voice_state: (oldState: VoiceLike, newState: VoiceLike): NewEvent =>
    build(newState.guild.id, 'voice_state', {
      user_id: newState.id,
      old_channel_id: oldState.channelId,
      new_channel_id: newState.channelId,
    }),

  scheduled_event: (action: ScheduledAction, e: ScheduledEventLike): NewEvent =>
    build(e.guildId, 'scheduled_event', { event_id: e.id, name: e.name, action }),
} satisfies { [K in EventType]?: (...args: never[]) => NewEvent | null }
