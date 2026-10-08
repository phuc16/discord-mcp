import { EventEmitter } from 'node:events'

export type PartialKind = 'Message' | 'Channel' | 'GuildMember'

export interface RawMessage {
  id: string
  channelId: string
  guildId: string
  content?: string
  author?: { id: string; bot?: boolean }
}

export interface RawMember {
  id: string
  guildId: string
  username?: string
  roles?: string[]
}

const rolesOf = (ids: string[] | undefined) => (ids ? { cache: new Map(ids.map((r) => [r, {}])) } : undefined)

export class FakeGatewayClient extends EventEmitter {
  loggedIn: string | null = null
  destroyed = false
  readonly partials: ReadonlySet<PartialKind>
  readonly messageCache = new Map<string, RawMessage>()
  readonly memberCache = new Map<string, RawMember>()

  constructor(partials: PartialKind[] = []) {
    super()
    this.partials = new Set(partials)
  }

  async login(token: string): Promise<string> {
    this.loggedIn = token
    return token
  }

  async destroy(): Promise<void> {
    this.destroyed = true
  }

  ready(): void {
    this.emit('clientReady')
  }

  shardReady(): void {
    this.emit('shardReady', 0)
  }

  shardResume(): void {
    this.emit('shardResume', 0, 0)
  }

  shardDisconnect(): void {
    this.emit('shardDisconnect', { code: 1006 }, 0)
  }

  cacheMessage(m: RawMessage): void {
    this.messageCache.set(m.id, m)
  }

  cacheMember(m: RawMember): void {
    this.memberCache.set(`${m.guildId}:${m.id}`, m)
  }

  private fullMessage(m: RawMessage) {
    return { id: m.id, channelId: m.channelId, guildId: m.guildId, content: m.content, author: m.author, partial: false, attachments: { size: 0 } }
  }

  messageDeleted(raw: Pick<RawMessage, 'id' | 'channelId' | 'guildId'>): boolean {
    const cached = this.messageCache.get(raw.id)
    if (cached) {
      this.emit('messageDelete', this.fullMessage(cached))
      return true
    }
    if (!this.partials.has('Message') || !this.partials.has('Channel')) return false
    this.emit('messageDelete', { id: raw.id, channelId: raw.channelId, guildId: raw.guildId, partial: true, content: null, author: null })
    return true
  }

  messageEdited(raw: RawMessage): boolean {
    const cached = this.messageCache.get(raw.id)
    if (cached) {
      this.emit('messageUpdate', this.fullMessage(cached), this.fullMessage(raw))
      return true
    }
    if (!this.partials.has('Message') || !this.partials.has('Channel')) return false
    this.emit(
      'messageUpdate',
      { id: raw.id, channelId: raw.channelId, guildId: raw.guildId, partial: true, content: null, author: null },
      this.fullMessage(raw),
    )
    return true
  }

  memberRemoved(raw: RawMember): boolean {
    const cached = this.memberCache.get(`${raw.guildId}:${raw.id}`)
    if (cached) {
      this.emit('guildMemberRemove', { id: cached.id, guild: { id: cached.guildId }, partial: false, user: { id: cached.id, username: cached.username }, roles: rolesOf(cached.roles) })
      return true
    }
    if (!this.partials.has('GuildMember')) return false
    this.emit('guildMemberRemove', { id: raw.id, guild: { id: raw.guildId }, partial: true, user: { id: raw.id, username: raw.username }, roles: undefined })
    return true
  }

  memberUpdated(raw: RawMember): boolean {
    const cached = this.memberCache.get(`${raw.guildId}:${raw.id}`)
    const next = { id: raw.id, guild: { id: raw.guildId }, partial: false, user: { id: raw.id, username: raw.username }, roles: rolesOf(raw.roles) }
    if (cached) {
      this.emit('guildMemberUpdate', { id: cached.id, guild: { id: cached.guildId }, partial: false, user: { id: cached.id, username: cached.username }, roles: rolesOf(cached.roles) }, next)
      this.memberCache.set(`${raw.guildId}:${raw.id}`, raw)
      return true
    }
    if (!this.partials.has('GuildMember')) return false
    this.emit('guildMemberUpdate', { id: raw.id, guild: { id: raw.guildId }, partial: true, user: { id: raw.id }, roles: undefined }, next)
    return true
  }
}
