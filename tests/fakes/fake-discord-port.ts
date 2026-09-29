import { McpToolError } from '../../src/contracts/index.js'
import type { DiscordPort, Dto, Payload, Snowflake } from '../../src/contracts/index.js'

let counter = 0
const nextId = (): string => {
  counter += 1
  return (400000000000000000n + BigInt(counter)).toString()
}

const notFound = (what: string, id: string): McpToolError => new McpToolError('not_found', `${what} ${id} not found`)

const take = <T>(v: T | undefined, what: string, id: string): T => {
  if (v === undefined) throw notFound(what, id)
  return v
}

const readOnlyMethods = new Set(['seedGuild'])

export class FakeDiscordPort implements DiscordPort {
  guilds = new Map<string, Dto>()
  channels = new Map<string, Dto>()
  roles = new Map<string, Dto[]>()
  members = new Map<string, Map<string, Dto>>()
  messages = new Map<string, Dto[]>()
  bans = new Map<string, Set<string>>()
  webhooks = new Map<string, Dto>()
  invites = new Map<string, Payload>()
  scheduledEvents = new Map<string, Dto>()
  emojis = new Map<string, Dto>()
  stickers = new Map<string, Dto>()
  automodRules = new Map<string, Dto>()
  memberPermissions = new Map<string, string>()
  banOptions = new Map<string, { delete_message_seconds?: number }>()
  auditEntries = new Map<string, Payload[]>()
  calls: { method: string; args: unknown[] }[] = []

  constructor() {
    for (const name of Object.getOwnPropertyNames(FakeDiscordPort.prototype)) {
      if (name === 'constructor' || readOnlyMethods.has(name)) continue
      const original = (this as unknown as Record<string, unknown>)[name]
      if (typeof original !== 'function') continue
      const bound = original.bind(this) as (...a: unknown[]) => unknown
      ;(this as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        this.calls.push({ method: name, args })
        return bound(...args)
      }
    }
  }

  seedGuild(id: string, opts: { channels?: number; roles?: number; members?: number } = {}): void {
    this.guilds.set(id, { id, name: `guild-${id}`, owner_id: '1', approximate_member_count: opts.members ?? 0 })
    this.roles.set(id, [{ id, name: '@everyone', permissions: '0', position: 0, guild_id: id }])
    this.members.set(id, new Map())
    this.bans.set(id, new Set())
    for (let i = 0; i < (opts.channels ?? 0); i++) this.#addChannel(id, { name: `channel-${i}`, type: 0 })
    for (let i = 0; i < (opts.roles ?? 0); i++) this.#addRole(id, { name: `role-${i}` })
    for (let i = 0; i < (opts.members ?? 0); i++) this.#addMember(id, nextId())
  }

  #guild(id: string): Dto {
    return take(this.guilds.get(id), 'guild', id)
  }

  #channel(id: string): Dto {
    return take(this.channels.get(id), 'channel', id)
  }

  #guildOf(channelId: string): string {
    return this.#channel(channelId).guild_id as string
  }

  #guildRoles(guildId: string): Dto[] {
    this.#guild(guildId)
    return this.roles.get(guildId) ?? []
  }

  #guildMembers(guildId: string): Map<string, Dto> {
    this.#guild(guildId)
    return take(this.members.get(guildId), 'guild', guildId)
  }

  #addChannel(guildId: string, spec: Payload): Dto {
    const c: Dto = { position: 0, ...spec, id: nextId(), guild_id: guildId }
    this.channels.set(c.id, c)
    return c
  }

  #addRole(guildId: string, spec: Payload): Dto {
    const r: Dto = { permissions: '0', position: 1, ...spec, id: nextId(), guild_id: guildId }
    this.#guildRoles(guildId).push(r)
    return r
  }

  #addMember(guildId: string, userId: string): Dto {
    const m: Dto = { id: userId, user: { id: userId, username: `user-${userId}` }, roles: [], nick: null }
    this.#guildMembers(guildId).set(userId, m)
    return m
  }

  #messagesOf(channelId: string): Dto[] {
    this.#channel(channelId)
    let list = this.messages.get(channelId)
    if (!list) {
      list = []
      this.messages.set(channelId, list)
    }
    return list
  }

  #message(channelId: string, messageId: string): Dto {
    return take(this.#messagesOf(channelId).find((m) => m.id === messageId), 'message', messageId)
  }

  #patch<T extends Dto>(target: T, patch: Payload): T {
    Object.assign(target, patch, { id: target.id })
    return target
  }

  async listBotGuildIds(): Promise<Snowflake[]> {
    return [...this.guilds.keys()]
  }

  async fetchMemberPermissions(guildId: Snowflake, userId: Snowflake): Promise<string> {
    return take(this.memberPermissions.get(`${guildId}:${userId}`), 'member', userId)
  }

  async getGuild(guildId: Snowflake): Promise<Dto> {
    return this.#guild(guildId)
  }

  async listGuilds(): Promise<Dto[]> {
    return [...this.guilds.values()]
  }

  async updateGuild(guildId: Snowflake, patch: Payload): Promise<Dto> {
    return this.#patch(this.#guild(guildId), patch)
  }

  async getGuildPreview(guildId: Snowflake): Promise<Dto> {
    const g = this.#guild(guildId)
    return { id: g.id, name: g.name }
  }

  async getPruneCount(guildId: Snowflake): Promise<{ pruned: number }> {
    this.#guild(guildId)
    return { pruned: 0 }
  }

  async pruneGuild(guildId: Snowflake): Promise<{ pruned: number }> {
    this.#guild(guildId)
    return { pruned: 0 }
  }

  async getWidget(guildId: Snowflake): Promise<Payload> {
    return { enabled: false, channel_id: null, ...(this.#guild(guildId).widget as Payload | undefined) }
  }

  async updateWidget(guildId: Snowflake, patch: Payload): Promise<Payload> {
    const g = this.#guild(guildId)
    g.widget = { ...(g.widget as Payload | undefined), ...patch }
    return g.widget as Payload
  }

  async listChannels(guildId: Snowflake): Promise<Dto[]> {
    this.#guild(guildId)
    return [...this.channels.values()].filter((c) => c.guild_id === guildId && ![10, 11, 12].includes(c.type as number))
  }

  async getChannel(channelId: Snowflake): Promise<Dto> {
    return this.#channel(channelId)
  }

  async createChannel(guildId: Snowflake, spec: Payload): Promise<Dto> {
    this.#guild(guildId)
    return this.#addChannel(guildId, spec)
  }

  async updateChannel(channelId: Snowflake, patch: Payload): Promise<Dto> {
    return this.#patch(this.#channel(channelId), patch)
  }

  async moveChannels(guildId: Snowflake, positions: { id: Snowflake; position: number; parent_id?: Snowflake | null }[]): Promise<void> {
    this.#guild(guildId)
    for (const p of positions) {
      const c = this.#channel(p.id)
      if (c.guild_id !== guildId) throw notFound('channel', p.id)
      c.position = p.position
      if (p.parent_id !== undefined) c.parent_id = p.parent_id
    }
  }

  async setChannelPermissions(channelId: Snowflake, overwriteId: Snowflake, body: { type: 0 | 1; allow: string; deny: string }): Promise<void> {
    const c = this.#channel(channelId)
    const list = ((c.permission_overwrites as Payload[] | undefined) ?? []).filter((o) => o.id !== overwriteId)
    list.push({ id: overwriteId, ...body })
    c.permission_overwrites = list
  }

  async deleteChannelPermissions(channelId: Snowflake, overwriteId: Snowflake): Promise<void> {
    const c = this.#channel(channelId)
    c.permission_overwrites = ((c.permission_overwrites as Payload[] | undefined) ?? []).filter((o) => o.id !== overwriteId)
  }

  async deleteChannel(channelId: Snowflake): Promise<Dto> {
    const c = this.#channel(channelId)
    this.channels.delete(channelId)
    this.messages.delete(channelId)
    return c
  }

  async listActiveThreads(guildId: Snowflake): Promise<Dto[]> {
    this.#guild(guildId)
    return [...this.channels.values()].filter((c) => c.guild_id === guildId && [10, 11, 12].includes(c.type as number))
  }

  async listArchivedThreads(channelId: Snowflake): Promise<Dto[]> {
    this.#channel(channelId)
    return []
  }

  async createThread(channelId: Snowflake, spec: Payload & { message_id?: Snowflake }): Promise<Dto> {
    const guildId = this.#guildOf(channelId)
    return this.#addChannel(guildId, { type: 11, parent_id: channelId, ...spec })
  }

  async addThreadMember(threadId: Snowflake): Promise<void> {
    this.#channel(threadId)
  }

  async removeThreadMember(threadId: Snowflake): Promise<void> {
    this.#channel(threadId)
  }

  async createForumPost(channelId: Snowflake, spec: Payload): Promise<Dto> {
    const guildId = this.#guildOf(channelId)
    return this.#addChannel(guildId, { type: 11, parent_id: channelId, ...spec })
  }

  async listRoles(guildId: Snowflake): Promise<Dto[]> {
    return [...this.#guildRoles(guildId)]
  }

  async createRole(guildId: Snowflake, spec: Payload): Promise<Dto> {
    this.#guild(guildId)
    return this.#addRole(guildId, spec)
  }

  async updateRole(guildId: Snowflake, roleId: Snowflake, patch: Payload): Promise<Dto> {
    return this.#patch(take(this.#guildRoles(guildId).find((r) => r.id === roleId), 'role', roleId), patch)
  }

  async reorderRoles(guildId: Snowflake, positions: { id: Snowflake; position: number }[]): Promise<Dto[]> {
    const roles = this.#guildRoles(guildId)
    for (const p of positions) take(roles.find((r) => r.id === p.id), 'role', p.id).position = p.position
    return [...roles]
  }

  async deleteRole(guildId: Snowflake, roleId: Snowflake): Promise<void> {
    const roles = this.#guildRoles(guildId)
    const idx = roles.findIndex((r) => r.id === roleId)
    if (idx < 0) throw notFound('role', roleId)
    roles.splice(idx, 1)
    for (const m of this.#guildMembers(guildId).values()) m.roles = (m.roles as string[]).filter((r) => r !== roleId)
  }

  async listMembers(guildId: Snowflake, q: { limit: number; after?: Snowflake }): Promise<Dto[]> {
    const all = [...this.#guildMembers(guildId).values()]
    const start = q.after ? all.findIndex((m) => m.id === q.after) + 1 : 0
    return all.slice(start, start + q.limit)
  }

  async getMember(guildId: Snowflake, userId: Snowflake): Promise<Dto> {
    return take(this.#guildMembers(guildId).get(userId), 'member', userId)
  }

  async searchMembers(guildId: Snowflake, query: string, limit: number): Promise<Dto[]> {
    const q = query.toLowerCase()
    return [...this.#guildMembers(guildId).values()]
      .filter((m) => String((m.user as Payload).username).toLowerCase().includes(q) || String(m.nick ?? '').toLowerCase().includes(q))
      .slice(0, limit)
  }

  async updateMember(guildId: Snowflake, userId: Snowflake, patch: Payload): Promise<Dto> {
    return this.#patch(take(this.#guildMembers(guildId).get(userId), 'member', userId), patch)
  }

  async addMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake): Promise<void> {
    const m = take(this.#guildMembers(guildId).get(userId), 'member', userId)
    take(this.#guildRoles(guildId).find((r) => r.id === roleId), 'role', roleId)
    const roles = m.roles as string[]
    if (!roles.includes(roleId)) roles.push(roleId)
  }

  async removeMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake): Promise<void> {
    const m = take(this.#guildMembers(guildId).get(userId), 'member', userId)
    m.roles = (m.roles as string[]).filter((r) => r !== roleId)
  }

  async kickMember(guildId: Snowflake, userId: Snowflake): Promise<void> {
    const members = this.#guildMembers(guildId)
    if (!members.delete(userId)) throw notFound('member', userId)
  }

  async banMember(guildId: Snowflake, userId: Snowflake, o: { delete_message_seconds?: number }): Promise<void> {
    this.#guildMembers(guildId).delete(userId)
    take(this.bans.get(guildId), 'guild', guildId).add(userId)
    this.banOptions.set(`${guildId}:${userId}`, o)
  }

  async unbanMember(guildId: Snowflake, userId: Snowflake): Promise<void> {
    this.#guild(guildId)
    if (!take(this.bans.get(guildId), 'guild', guildId).delete(userId)) throw notFound('ban', userId)
  }

  async bulkBan(guildId: Snowflake, userIds: Snowflake[], o: { delete_message_seconds?: number }): Promise<{ banned_users: Snowflake[]; failed_users: Snowflake[] }> {
    const members = this.#guildMembers(guildId)
    const bans = take(this.bans.get(guildId), 'guild', guildId)
    const banned: string[] = []
    const failed: string[] = []
    for (const id of userIds) {
      if (members.delete(id)) {
        bans.add(id)
        this.banOptions.set(`${guildId}:${id}`, o)
        banned.push(id)
      } else failed.push(id)
    }
    return { banned_users: banned, failed_users: failed }
  }

  async listBans(guildId: Snowflake, q: { limit: number; after?: Snowflake }): Promise<Payload[]> {
    this.#guild(guildId)
    return [...take(this.bans.get(guildId), 'guild', guildId)]
      .filter((id) => !q.after || id > q.after)
      .slice(0, q.limit)
      .map((id) => ({ user: { id }, reason: null }))
  }

  async listAutomodRules(guildId: Snowflake): Promise<Dto[]> {
    this.#guild(guildId)
    return [...this.automodRules.values()].filter((r) => r.guild_id === guildId)
  }

  async createAutomodRule(guildId: Snowflake, spec: Payload): Promise<Dto> {
    this.#guild(guildId)
    const r: Dto = { ...spec, id: nextId(), guild_id: guildId }
    this.automodRules.set(r.id, r)
    return r
  }

  async updateAutomodRule(guildId: Snowflake, ruleId: Snowflake, patch: Payload): Promise<Dto> {
    return this.#patch(this.#scoped(this.automodRules, guildId, ruleId, 'automod rule'), patch)
  }

  async deleteAutomodRule(guildId: Snowflake, ruleId: Snowflake): Promise<void> {
    this.#scoped(this.automodRules, guildId, ruleId, 'automod rule')
    this.automodRules.delete(ruleId)
  }

  #scoped(map: Map<string, Dto>, guildId: string, id: string, what: string): Dto {
    this.#guild(guildId)
    const v = map.get(id)
    if (!v || v.guild_id !== guildId) throw notFound(what, id)
    return v
  }

  async listMessages(channelId: Snowflake, q: { limit: number; before?: Snowflake; after?: Snowflake }): Promise<Dto[]> {
    let list = [...this.#messagesOf(channelId)]
    if (q.before) list = list.filter((m) => BigInt(m.id) < BigInt(q.before as string))
    if (q.after) list = list.filter((m) => BigInt(m.id) > BigInt(q.after as string))
    return list.slice(-q.limit).reverse()
  }

  async getMessage(channelId: Snowflake, messageId: Snowflake): Promise<Dto> {
    return this.#message(channelId, messageId)
  }

  async sendMessage(channelId: Snowflake, body: Payload): Promise<Dto> {
    const list = this.#messagesOf(channelId)
    const m: Dto = { pinned: false, reactions: [], ...body, id: nextId(), channel_id: channelId, guild_id: this.#guildOf(channelId), author: { id: 'bot', bot: true } }
    list.push(m)
    return m
  }

  async editMessage(channelId: Snowflake, messageId: Snowflake, body: Payload): Promise<Dto> {
    return this.#patch(this.#message(channelId, messageId), body)
  }

  async deleteMessage(channelId: Snowflake, messageId: Snowflake): Promise<void> {
    const list = this.#messagesOf(channelId)
    const idx = list.findIndex((m) => m.id === messageId)
    if (idx < 0) throw notFound('message', messageId)
    list.splice(idx, 1)
  }

  async bulkDeleteMessages(channelId: Snowflake, messageIds: Snowflake[]): Promise<void> {
    const list = this.#messagesOf(channelId)
    for (const id of messageIds) take(list.find((m) => m.id === id), 'message', id)
    this.messages.set(channelId, list.filter((m) => !messageIds.includes(m.id)))
  }

  async pinMessage(channelId: Snowflake, messageId: Snowflake): Promise<void> {
    this.#message(channelId, messageId).pinned = true
  }

  async unpinMessage(channelId: Snowflake, messageId: Snowflake): Promise<void> {
    this.#message(channelId, messageId).pinned = false
  }

  async listPins(channelId: Snowflake): Promise<Dto[]> {
    return this.#messagesOf(channelId).filter((m) => m.pinned === true)
  }

  async crosspostMessage(channelId: Snowflake, messageId: Snowflake): Promise<Dto> {
    return this.#message(channelId, messageId)
  }

  async addReaction(channelId: Snowflake, messageId: Snowflake, emoji: string): Promise<void> {
    const m = this.#message(channelId, messageId)
    const reactions = m.reactions as { emoji: string; count: number }[]
    const existing = reactions.find((r) => r.emoji === emoji)
    if (existing) existing.count += 1
    else reactions.push({ emoji, count: 1 })
  }

  async removeReaction(channelId: Snowflake, messageId: Snowflake, emoji: string): Promise<void> {
    const m = this.#message(channelId, messageId)
    m.reactions = (m.reactions as { emoji: string; count: number }[])
      .map((r) => (r.emoji === emoji ? { ...r, count: r.count - 1 } : r))
      .filter((r) => r.count > 0)
  }

  async clearReactions(channelId: Snowflake, messageId: Snowflake): Promise<void> {
    this.#message(channelId, messageId).reactions = []
  }

  async listWebhooks(scope: { guildId: Snowflake } | { channelId: Snowflake }): Promise<Dto[]> {
    if ('guildId' in scope) {
      this.#guild(scope.guildId)
      return [...this.webhooks.values()].filter((w) => w.guild_id === scope.guildId)
    }
    this.#channel(scope.channelId)
    return [...this.webhooks.values()].filter((w) => w.channel_id === scope.channelId)
  }

  async createWebhook(channelId: Snowflake, spec: Payload): Promise<Dto> {
    const w: Dto = { ...spec, id: nextId(), channel_id: channelId, guild_id: this.#guildOf(channelId), token: `wh-token-${counter}` }
    this.webhooks.set(w.id, w)
    return w
  }

  async updateWebhook(webhookId: Snowflake, patch: Payload): Promise<Dto> {
    return this.#patch(take(this.webhooks.get(webhookId), 'webhook', webhookId), patch)
  }

  async executeWebhook(webhookId: Snowflake, token: string, body: Payload): Promise<Dto | null> {
    const w = take(this.webhooks.get(webhookId), 'webhook', webhookId)
    if (w.token !== token) throw notFound('webhook', webhookId)
    return { id: nextId(), channel_id: w.channel_id, guild_id: w.guild_id, ...body }
  }

  async deleteWebhook(webhookId: Snowflake): Promise<void> {
    if (!this.webhooks.delete(webhookId)) throw notFound('webhook', webhookId)
  }

  async listScheduledEvents(guildId: Snowflake): Promise<Dto[]> {
    this.#guild(guildId)
    return [...this.scheduledEvents.values()].filter((e) => e.guild_id === guildId)
  }

  async getScheduledEvent(guildId: Snowflake, eventId: Snowflake): Promise<Dto> {
    return this.#scoped(this.scheduledEvents, guildId, eventId, 'scheduled event')
  }

  async createScheduledEvent(guildId: Snowflake, spec: Payload): Promise<Dto> {
    this.#guild(guildId)
    const e: Dto = { ...spec, id: nextId(), guild_id: guildId }
    this.scheduledEvents.set(e.id, e)
    return e
  }

  async updateScheduledEvent(guildId: Snowflake, eventId: Snowflake, patch: Payload): Promise<Dto> {
    return this.#patch(this.#scoped(this.scheduledEvents, guildId, eventId, 'scheduled event'), patch)
  }

  async listScheduledEventUsers(guildId: Snowflake, eventId: Snowflake): Promise<Payload[]> {
    this.#scoped(this.scheduledEvents, guildId, eventId, 'scheduled event')
    return []
  }

  async deleteScheduledEvent(guildId: Snowflake, eventId: Snowflake): Promise<void> {
    this.#scoped(this.scheduledEvents, guildId, eventId, 'scheduled event')
    this.scheduledEvents.delete(eventId)
  }

  async listInvites(guildId: Snowflake): Promise<Payload[]> {
    this.#guild(guildId)
    return [...this.invites.values()].filter((i) => (i.guild as { id: string }).id === guildId)
  }

  async createInvite(channelId: Snowflake, spec: Payload): Promise<Payload> {
    const guildId = this.#guildOf(channelId)
    const code = `inv${nextId().slice(-8)}`
    const inv: Payload = { ...spec, code, channel: { id: channelId }, guild: { id: guildId } }
    this.invites.set(code, inv)
    return inv
  }

  async deleteInvite(code: string): Promise<Payload> {
    const inv = take(this.invites.get(code), 'invite', code)
    this.invites.delete(code)
    return inv
  }

  async listEmojis(guildId: Snowflake): Promise<Dto[]> {
    this.#guild(guildId)
    return [...this.emojis.values()].filter((e) => e.guild_id === guildId)
  }

  async createEmoji(guildId: Snowflake, spec: { name: string; image: string; roles?: Snowflake[] }): Promise<Dto> {
    this.#guild(guildId)
    const e: Dto = { name: spec.name, roles: spec.roles ?? [], id: nextId(), guild_id: guildId }
    this.emojis.set(e.id, e)
    return e
  }

  async updateEmoji(guildId: Snowflake, emojiId: Snowflake, patch: Payload): Promise<Dto> {
    return this.#patch(this.#scoped(this.emojis, guildId, emojiId, 'emoji'), patch)
  }

  async deleteEmoji(guildId: Snowflake, emojiId: Snowflake): Promise<void> {
    this.#scoped(this.emojis, guildId, emojiId, 'emoji')
    this.emojis.delete(emojiId)
  }

  async listStickers(guildId: Snowflake): Promise<Dto[]> {
    this.#guild(guildId)
    return [...this.stickers.values()].filter((s) => s.guild_id === guildId)
  }

  async createSticker(guildId: Snowflake, spec: { name: string; description: string; tags: string; file: string }): Promise<Dto> {
    this.#guild(guildId)
    const s: Dto = { name: spec.name, description: spec.description, tags: spec.tags, id: nextId(), guild_id: guildId }
    this.stickers.set(s.id, s)
    return s
  }

  async deleteSticker(guildId: Snowflake, stickerId: Snowflake): Promise<void> {
    this.#scoped(this.stickers, guildId, stickerId, 'sticker')
    this.stickers.delete(stickerId)
  }

  async listAuditLog(guildId: Snowflake, q: { user_id?: Snowflake; action_type?: number; limit?: number; before?: Snowflake }): Promise<Payload> {
    this.#guild(guildId)
    const entries = (this.auditEntries.get(guildId) ?? [])
      .filter((e) => (!q.user_id || e.user_id === q.user_id) && (q.action_type === undefined || e.action_type === q.action_type))
      .slice(0, q.limit ?? 50)
    return { audit_log_entries: entries, users: [], webhooks: [] }
  }
}
