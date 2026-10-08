import { McpToolError } from '../../src/contracts/index.js'
import type { DiscordPort, Dto, Payload, Snowflake } from '../../src/contracts/index.js'

const DISCORD_EPOCH = 1_420_070_400_000n
let counter = 0
const nextId = (): string => {
  counter += 1
  return (((BigInt(Date.now()) - DISCORD_EPOCH) << 22n) | BigInt(counter)).toString()
}

const notFound = (what: string, id: string): McpToolError => new McpToolError('not_found', `${what} ${id} not found`)

const take = <T>(v: T | undefined, what: string, id: string): T => {
  if (v === undefined) throw notFound(what, id)
  return v
}

const omit = (o: Payload, ...keys: string[]): Payload => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))

const invalid = (message: string): McpToolError => new McpToolError('invalid_input', message)

const cmpId = (a: string, b: string): number => {
  const d = BigInt(a) - BigInt(b)
  return d < 0n ? -1 : d > 0n ? 1 : 0
}

const PERMISSION_BITS = /^\d{1,20}$/
const THREAD_ARCHIVE_MINUTES = new Set([60, 1440, 4320, 10080])
const THREAD_PARENT_TYPES: Record<number, number[]> = { 11: [0, 5], 12: [0], 10: [5] }
const STICKER_MIME = new Set(['image/png', 'image/apng', 'application/json'])
const STICKER_EXT: Record<string, RegExp> = { 'image/png': /\.png$/i, 'image/apng': /\.(png|apng)$/i, 'application/json': /\.json$/i }
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/
const STICKER_MAX_BYTES = 512 * 1024
const AUTOMOD_EVENT_MESSAGE_SEND = 1
const AUTOMOD_EVENT_MEMBER_UPDATE = 2
const AUTOMOD_TRIGGER_MEMBER_PROFILE = 6
const AUTOMOD_MAX_TIMEOUT_SECONDS = 2_419_200
const MAX_ROLES = 250

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
  auditExtras: { webhooks?: Payload[]; integrations?: Payload[]; users?: Payload[] } = {}
  stickerUploads: { field: string; contentType: string; filename: string; name: string }[] = []
  calls: { method: string; args: unknown[]; ok?: boolean }[] = []

  constructor() {
    for (const name of Object.getOwnPropertyNames(FakeDiscordPort.prototype)) {
      if (name === 'constructor' || readOnlyMethods.has(name)) continue
      const original = (this as unknown as Record<string, unknown>)[name]
      if (typeof original !== 'function') continue
      const bound = original.bind(this) as (...a: unknown[]) => unknown
      ;(this as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
        const entry: { method: string; args: unknown[]; ok?: boolean } = { method: name, args }
        this.calls.push(entry)
        const result = bound(...args) as Promise<unknown>
        result.then(
          () => {
            entry.ok = true
          },
          () => {
            entry.ok = false
          },
        )
        return result
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
    const m = { user: { id: userId, username: `user-${userId}` }, roles: [], nick: null } as unknown as Dto
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

  #patchMember(target: Dto, patch: Payload): Dto {
    Object.assign(target, omit(patch, 'id', 'user'))
    return target
  }

  #validateRole(spec: Payload): void {
    if (spec.name !== undefined && (typeof spec.name !== 'string' || spec.name.length < 1 || spec.name.length > 100)) throw invalid('role name must be 1-100 characters')
    if (spec.permissions !== undefined && !(typeof spec.permissions === 'string' && PERMISSION_BITS.test(spec.permissions))) throw invalid('role permissions must be a decimal string')
    if (spec.color !== undefined && !(Number.isInteger(spec.color) && (spec.color as number) >= 0 && (spec.color as number) <= 0xffffff)) throw invalid('role color out of range')
    if (spec.hoist !== undefined && typeof spec.hoist !== 'boolean') throw invalid('role hoist must be boolean')
    if (spec.mentionable !== undefined && typeof spec.mentionable !== 'boolean') throw invalid('role mentionable must be boolean')
  }

  #validateAutomod(spec: Payload, existing?: Dto): void {
    const merged = { ...existing, ...spec }
    if (spec.name !== undefined && (typeof spec.name !== 'string' || spec.name.length < 1 || spec.name.length > 100)) throw invalid('automod name must be 1-100 characters')
    if (existing === undefined) {
      if (merged.event_type === undefined || merged.trigger_type === undefined || merged.actions === undefined) throw invalid('automod rule needs event_type, trigger_type and actions')
    }
    if (merged.event_type !== undefined && ![AUTOMOD_EVENT_MESSAGE_SEND, AUTOMOD_EVENT_MEMBER_UPDATE].includes(merged.event_type as number)) throw invalid('automod event_type must be 1 or 2')
    if (merged.trigger_type === AUTOMOD_TRIGGER_MEMBER_PROFILE && merged.event_type !== AUTOMOD_EVENT_MEMBER_UPDATE) throw invalid('automod trigger_type 6 requires event_type 2')
    if (merged.trigger_type !== AUTOMOD_TRIGGER_MEMBER_PROFILE && merged.event_type === AUTOMOD_EVENT_MEMBER_UPDATE) throw invalid('automod event_type 2 requires trigger_type 6')
    const actions = merged.actions
    if (actions !== undefined) {
      if (!Array.isArray(actions) || actions.length < 1 || actions.length > 3) throw invalid('automod needs 1-3 actions')
      for (const a of actions as Payload[]) {
        const meta = (a.metadata as Payload | undefined) ?? {}
        if (![1, 2, 3].includes(a.type as number)) throw invalid('automod action type must be 1, 2 or 3')
        if (a.type === 2 && typeof meta.channel_id !== 'string') throw invalid('automod send_alert_message action needs metadata.channel_id')
        if (a.type === 3) {
          const d = meta.duration_seconds
          if (!Number.isInteger(d) || (d as number) < 1 || (d as number) > AUTOMOD_MAX_TIMEOUT_SECONDS) throw invalid('automod timeout action needs metadata.duration_seconds within 4 weeks')
        }
      }
    }
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
    const c = this.#channel(channelId)
    if (patch.parent_id !== undefined && patch.parent_id !== null && this.#channel(patch.parent_id as string).guild_id !== c.guild_id) throw notFound('channel', patch.parent_id as string)
    return this.#patch(c, patch)
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

  async listArchivedThreads(channelId: Snowflake, q: { kind: 'public' | 'private'; before?: string; limit?: number }): Promise<{ threads: Dto[]; has_more: boolean }> {
    const parent = this.#channel(channelId)
    if (q.before !== undefined && Number.isNaN(Date.parse(q.before))) throw invalid('before must be an ISO8601 timestamp')
    const wanted = q.kind === 'public' ? [10, 11] : [12]
    const all = [...this.channels.values()].filter(
      (c) => c.parent_id === parent.id && wanted.includes(c.type as number) && (c.thread_metadata as Payload | undefined)?.archived === true,
    )
    const limit = q.limit ?? 50
    return { threads: all.slice(0, limit), has_more: all.length > limit }
  }

  async createThread(channelId: Snowflake, spec: Payload & { message_id?: Snowflake }): Promise<Dto> {
    const parent = this.#channel(channelId)
    const { message_id: messageId, ...rest } = spec
    if (typeof rest.name !== 'string' || rest.name.length < 1 || rest.name.length > 100) throw invalid('thread name must be 1-100 characters')
    if (rest.auto_archive_duration !== undefined && !THREAD_ARCHIVE_MINUTES.has(rest.auto_archive_duration as number)) throw invalid('auto_archive_duration must be 60, 1440, 4320 or 10080')
    if (parent.type === 15) throw invalid('use createForumPost for forum channels')
    if (messageId !== undefined) {
      this.#message(channelId, messageId)
      if (![0, 5].includes(parent.type as number)) throw invalid('threads from a message need a text or announcement channel')
      if ([...this.channels.values()].some((c) => c.id === messageId && c.parent_id === channelId)) throw invalid('a thread already exists for this message')
      const thread = this.#addChannel(parent.guild_id as string, { ...rest, id: undefined, type: parent.type === 5 ? 10 : 11, parent_id: channelId, thread_metadata: { archived: false } })
      this.channels.delete(thread.id)
      const withId = { ...thread, id: messageId }
      this.channels.set(messageId, withId)
      return withId
    }
    const type = (rest.type as number | undefined) ?? 12
    if (!THREAD_PARENT_TYPES[type]) throw invalid('thread type must be 10, 11 or 12')
    if (!THREAD_PARENT_TYPES[type]!.includes(parent.type as number)) throw invalid(`thread type ${type} cannot be created in a channel of type ${String(parent.type)}`)
    return this.#addChannel(parent.guild_id as string, { ...rest, type, parent_id: channelId, thread_metadata: { archived: false } })
  }

  async addThreadMember(threadId: Snowflake, userId: Snowflake): Promise<void> {
    const t = this.#channel(threadId)
    if (![10, 11, 12].includes(t.type as number)) throw invalid('not a thread')
    take(this.#guildMembers(t.guild_id as string).get(userId), 'member', userId)
  }

  async removeThreadMember(threadId: Snowflake, userId: Snowflake): Promise<void> {
    const t = this.#channel(threadId)
    if (![10, 11, 12].includes(t.type as number)) throw invalid('not a thread')
    take(this.#guildMembers(t.guild_id as string).get(userId), 'member', userId)
  }

  async createForumPost(channelId: Snowflake, spec: Payload): Promise<Dto> {
    const parent = this.#channel(channelId)
    if (![15, 16].includes(parent.type as number)) throw invalid('forum posts need a forum or media channel')
    if (typeof spec.name !== 'string' || spec.name.length < 1 || spec.name.length > 100) throw invalid('post name must be 1-100 characters')
    const message = spec.message as Payload | undefined
    if (!message || (message.content === undefined && message.embeds === undefined)) throw invalid('forum post needs message content or embeds')
    const available = new Set(((parent.available_tags as Payload[] | undefined) ?? []).map((t) => t.id as string))
    for (const tag of (spec.applied_tags as string[] | undefined) ?? []) if (!available.has(tag)) throw invalid(`unknown forum tag ${tag}`)
    const post = this.#addChannel(parent.guild_id as string, { ...omit(spec, 'message'), type: 11, parent_id: channelId, thread_metadata: { archived: false } })
    this.#messagesOf(post.id).push({ id: post.id, channel_id: post.id, guild_id: post.guild_id, pinned: false, reactions: [], ...message, author: { id: 'bot', bot: true } })
    return { ...post, message: this.#messagesOf(post.id)[0] }
  }

  async listRoles(guildId: Snowflake): Promise<Dto[]> {
    return [...this.#guildRoles(guildId)]
  }

  async createRole(guildId: Snowflake, spec: Payload): Promise<Dto> {
    this.#validateRole(spec)
    if (this.#guildRoles(guildId).length >= MAX_ROLES) throw invalid('maximum number of roles reached')
    return this.#addRole(guildId, omit(spec, 'position'))
  }

  async updateRole(guildId: Snowflake, roleId: Snowflake, patch: Payload): Promise<Dto> {
    const role = take(this.#guildRoles(guildId).find((r) => r.id === roleId), 'role', roleId)
    if (roleId === guildId && patch.name !== undefined) throw invalid('the @everyone role cannot be renamed')
    this.#validateRole(patch)
    return this.#patch(role, patch)
  }

  async reorderRoles(guildId: Snowflake, positions: { id: Snowflake; position: number }[]): Promise<Dto[]> {
    const roles = this.#guildRoles(guildId)
    for (const p of positions) {
      if (!Number.isInteger(p.position) || p.position < 0) throw invalid('role position must be a non-negative integer')
      if (p.id === guildId) throw invalid('the @everyone role cannot be moved')
      take(roles.find((r) => r.id === p.id), 'role', p.id).position = p.position
    }
    return [...roles]
  }

  async deleteRole(guildId: Snowflake, roleId: Snowflake): Promise<void> {
    const roles = this.#guildRoles(guildId)
    const idx = roles.findIndex((r) => r.id === roleId)
    if (idx < 0) throw notFound('role', roleId)
    if (roleId === guildId) throw invalid('the @everyone role cannot be deleted')
    roles.splice(idx, 1)
    for (const m of this.#guildMembers(guildId).values()) m.roles = (m.roles as string[]).filter((r) => r !== roleId)
  }

  async listMembers(guildId: Snowflake, q: { limit: number; after?: Snowflake }): Promise<Dto[]> {
    if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > 1000) throw invalid('limit must be 1-1000')
    return [...this.#guildMembers(guildId).values()]
      .filter((m) => q.after === undefined || cmpId((m.user as Payload).id as string, q.after) > 0)
      .sort((a, b) => cmpId((a.user as Payload).id as string, (b.user as Payload).id as string))
      .slice(0, q.limit)
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
    return this.#patchMember(take(this.#guildMembers(guildId).get(userId), 'member', userId), patch)
  }

  async addMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake): Promise<void> {
    const m = take(this.#guildMembers(guildId).get(userId), 'member', userId)
    take(this.#guildRoles(guildId).find((r) => r.id === roleId), 'role', roleId)
    const roles = m.roles as string[]
    if (!roles.includes(roleId)) roles.push(roleId)
  }

  async removeMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake): Promise<void> {
    const m = take(this.#guildMembers(guildId).get(userId), 'member', userId)
    take(this.#guildRoles(guildId).find((r) => r.id === roleId), 'role', roleId)
    m.roles = (m.roles as string[]).filter((r) => r !== roleId)
  }

  async kickMember(guildId: Snowflake, userId: Snowflake): Promise<void> {
    const members = this.#guildMembers(guildId)
    if (!members.delete(userId)) throw notFound('member', userId)
  }

  async banMember(guildId: Snowflake, userId: Snowflake, o: { delete_message_seconds?: number }): Promise<void> {
    if (o.delete_message_seconds !== undefined && (o.delete_message_seconds < 0 || o.delete_message_seconds > 604_800)) throw invalid('delete_message_seconds must be 0-604800')
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
    if (banned.length === 0) throw invalid('none of the users could be banned')
    return { banned_users: banned, failed_users: failed }
  }

  async listBans(guildId: Snowflake, q: { limit: number; after?: Snowflake }): Promise<Payload[]> {
    this.#guild(guildId)
    return [...take(this.bans.get(guildId), 'guild', guildId)]
      .sort(cmpId)
      .filter((id) => !q.after || cmpId(id, q.after) > 0)
      .slice(0, q.limit)
      .map((id) => ({ user: { id }, reason: null }))
  }

  async listAutomodRules(guildId: Snowflake): Promise<Dto[]> {
    this.#guild(guildId)
    return [...this.automodRules.values()].filter((r) => r.guild_id === guildId)
  }

  async createAutomodRule(guildId: Snowflake, spec: Payload): Promise<Dto> {
    this.#guild(guildId)
    this.#validateAutomod(spec)
    const r: Dto = { enabled: true, ...spec, id: nextId(), guild_id: guildId }
    this.automodRules.set(r.id, r)
    return r
  }

  async updateAutomodRule(guildId: Snowflake, ruleId: Snowflake, patch: Payload): Promise<Dto> {
    const rule = this.#scoped(this.automodRules, guildId, ruleId, 'automod rule')
    this.#validateAutomod(patch, rule)
    return this.#patch(rule, patch)
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

  async createSticker(
    guildId: Snowflake,
    spec: { name: string; description: string; tags: string; file: string; filename?: string; content_type?: string },
  ): Promise<Dto> {
    this.#guild(guildId)
    if (spec.name.length < 2 || spec.name.length > 30) throw invalid('sticker name must be 2-30 characters')
    if (spec.description.length !== 0 && (spec.description.length < 2 || spec.description.length > 100)) throw invalid('sticker description must be empty or 2-100 characters')
    if (spec.tags.length < 1 || spec.tags.length > 200) throw invalid('sticker tags must be 1-200 characters')
    const contentType = spec.content_type ?? 'image/png'
    const filename = spec.filename ?? 'sticker.png'
    if (!STICKER_MIME.has(contentType)) throw invalid('sticker content type must be image/png, image/apng or application/json')
    if (!STICKER_EXT[contentType]!.test(filename)) throw invalid('sticker filename extension does not match its content type')
    if (!BASE64.test(spec.file) || spec.file.length % 4 !== 0) throw invalid('sticker file must be base64')
    if (Buffer.from(spec.file, 'base64').length > STICKER_MAX_BYTES) throw invalid('sticker file is larger than 512KB')
    this.stickerUploads.push({ field: 'file', contentType, filename, name: spec.name })
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
    return { audit_log_entries: entries, users: this.auditExtras.users ?? [], webhooks: this.auditExtras.webhooks ?? [], integrations: this.auditExtras.integrations ?? [] }
  }
}
