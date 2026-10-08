import type { NewEvent } from './events.js'

export type Snowflake = string
export type Dto = { id: Snowflake } & Record<string, unknown>
export type Payload = Record<string, unknown>

export interface DiscordPort {
  listBotGuildIds(): Promise<Snowflake[]>
  fetchMemberPermissions(guildId: Snowflake, userId: Snowflake): Promise<string>

  getGuild(guildId: Snowflake): Promise<Dto>
  listGuilds(): Promise<Dto[]>
  updateGuild(guildId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  getGuildPreview(guildId: Snowflake): Promise<Dto>
  getPruneCount(guildId: Snowflake, days: number): Promise<{ pruned: number }>
  pruneGuild(guildId: Snowflake, days: number, reason?: string): Promise<{ pruned: number }>
  getWidget(guildId: Snowflake): Promise<Payload>
  updateWidget(guildId: Snowflake, patch: Payload): Promise<Payload>

  listChannels(guildId: Snowflake): Promise<Dto[]>
  getChannel(channelId: Snowflake): Promise<Dto>
  createChannel(guildId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateChannel(channelId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  moveChannels(guildId: Snowflake, positions: { id: Snowflake; position: number; parent_id?: Snowflake | null }[]): Promise<void>
  setChannelPermissions(channelId: Snowflake, overwriteId: Snowflake, body: { type: 0 | 1; allow: string; deny: string }, reason?: string): Promise<void>
  deleteChannelPermissions(channelId: Snowflake, overwriteId: Snowflake, reason?: string): Promise<void>
  deleteChannel(channelId: Snowflake, reason?: string): Promise<Dto>

  listActiveThreads(guildId: Snowflake): Promise<Dto[]>
  listArchivedThreads(channelId: Snowflake, q: { kind: 'public' | 'private'; before?: string; limit?: number }): Promise<{ threads: Dto[]; has_more: boolean }>
  createThread(channelId: Snowflake, spec: Payload & { message_id?: Snowflake }, reason?: string): Promise<Dto>
  addThreadMember(threadId: Snowflake, userId: Snowflake): Promise<void>
  removeThreadMember(threadId: Snowflake, userId: Snowflake): Promise<void>
  createForumPost(channelId: Snowflake, spec: Payload, reason?: string): Promise<Dto>

  listRoles(guildId: Snowflake): Promise<Dto[]>
  createRole(guildId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateRole(guildId: Snowflake, roleId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  reorderRoles(guildId: Snowflake, positions: { id: Snowflake; position: number }[]): Promise<Dto[]>
  deleteRole(guildId: Snowflake, roleId: Snowflake, reason?: string): Promise<void>

  listMembers(guildId: Snowflake, q: { limit: number; after?: Snowflake }): Promise<Dto[]>
  getMember(guildId: Snowflake, userId: Snowflake): Promise<Dto>
  searchMembers(guildId: Snowflake, query: string, limit: number): Promise<Dto[]>
  updateMember(guildId: Snowflake, userId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  addMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake, reason?: string): Promise<void>
  removeMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake, reason?: string): Promise<void>

  kickMember(guildId: Snowflake, userId: Snowflake, reason?: string): Promise<void>
  banMember(guildId: Snowflake, userId: Snowflake, o: { delete_message_seconds?: number }, reason?: string): Promise<void>
  unbanMember(guildId: Snowflake, userId: Snowflake, reason?: string): Promise<void>
  bulkBan(guildId: Snowflake, userIds: Snowflake[], o: { delete_message_seconds?: number }, reason?: string): Promise<{ banned_users: Snowflake[]; failed_users: Snowflake[] }>
  listBans(guildId: Snowflake, q: { limit: number; after?: Snowflake }): Promise<Payload[]>
  listAutomodRules(guildId: Snowflake): Promise<Dto[]>
  createAutomodRule(guildId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateAutomodRule(guildId: Snowflake, ruleId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  deleteAutomodRule(guildId: Snowflake, ruleId: Snowflake, reason?: string): Promise<void>

  listMessages(channelId: Snowflake, q: { limit: number; before?: Snowflake; after?: Snowflake }): Promise<Dto[]>
  getMessage(channelId: Snowflake, messageId: Snowflake): Promise<Dto>
  sendMessage(channelId: Snowflake, body: Payload): Promise<Dto>
  editMessage(channelId: Snowflake, messageId: Snowflake, body: Payload): Promise<Dto>
  deleteMessage(channelId: Snowflake, messageId: Snowflake, reason?: string): Promise<void>
  bulkDeleteMessages(channelId: Snowflake, messageIds: Snowflake[], reason?: string): Promise<void>
  pinMessage(channelId: Snowflake, messageId: Snowflake, reason?: string): Promise<void>
  unpinMessage(channelId: Snowflake, messageId: Snowflake, reason?: string): Promise<void>
  listPins(channelId: Snowflake): Promise<Dto[]>
  crosspostMessage(channelId: Snowflake, messageId: Snowflake): Promise<Dto>
  addReaction(channelId: Snowflake, messageId: Snowflake, emoji: string): Promise<void>
  removeReaction(channelId: Snowflake, messageId: Snowflake, emoji: string, userId?: Snowflake): Promise<void>
  clearReactions(channelId: Snowflake, messageId: Snowflake): Promise<void>

  listWebhooks(scope: { guildId: Snowflake } | { channelId: Snowflake }): Promise<Dto[]>
  createWebhook(channelId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateWebhook(webhookId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  executeWebhook(webhookId: Snowflake, token: string, body: Payload): Promise<Dto | null>
  deleteWebhook(webhookId: Snowflake, reason?: string): Promise<void>

  listScheduledEvents(guildId: Snowflake): Promise<Dto[]>
  getScheduledEvent(guildId: Snowflake, eventId: Snowflake): Promise<Dto>
  createScheduledEvent(guildId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateScheduledEvent(guildId: Snowflake, eventId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  listScheduledEventUsers(guildId: Snowflake, eventId: Snowflake, limit: number): Promise<Payload[]>
  deleteScheduledEvent(guildId: Snowflake, eventId: Snowflake, reason?: string): Promise<void>

  listInvites(guildId: Snowflake): Promise<Payload[]>
  createInvite(channelId: Snowflake, spec: Payload, reason?: string): Promise<Payload>
  deleteInvite(code: string, reason?: string): Promise<Payload>

  listEmojis(guildId: Snowflake): Promise<Dto[]>
  createEmoji(guildId: Snowflake, spec: { name: string; image: string; roles?: Snowflake[] }, reason?: string): Promise<Dto>
  updateEmoji(guildId: Snowflake, emojiId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  deleteEmoji(guildId: Snowflake, emojiId: Snowflake, reason?: string): Promise<void>
  listStickers(guildId: Snowflake): Promise<Dto[]>
  createSticker(guildId: Snowflake, spec: { name: string; description: string; tags: string; file: string; filename?: string; content_type?: 'image/png' | 'image/apng' | 'application/json' }, reason?: string): Promise<Dto>
  deleteSticker(guildId: Snowflake, stickerId: Snowflake, reason?: string): Promise<void>

  listAuditLog(guildId: Snowflake, q: { user_id?: Snowflake; action_type?: number; limit?: number; before?: Snowflake }): Promise<Payload>
}

export type GatewayStatus = 'connecting' | 'ready' | 'disconnected'
export interface GatewayStatusInfo { disconnectedAt: string; reconnectedAt: string; resumed: boolean }
export interface GatewayPort {
  start(): Promise<void>
  stop(): Promise<void>
  onEvent(cb: (e: NewEvent) => void): () => void
  onStatus(cb: (s: GatewayStatus, info?: GatewayStatusInfo) => void): () => void
  status(): GatewayStatus
}

export interface DiscordOAuthPort {
  exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string }>
  fetchUser(accessToken: string): Promise<{ id: Snowflake; username: string }>
  fetchUserGuilds(accessToken: string): Promise<{ id: Snowflake; permissions: string }[]>
}
