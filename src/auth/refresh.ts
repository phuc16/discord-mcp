import { McpToolError } from '../contracts/index.js'
import type { DiscordPort, NormalizedEvent } from '../contracts/index.js'
import type { Session, Store } from '../store/index.js'

const GUILD_WIDE_EVENTS: ReadonlySet<string> = new Set(['role_create', 'role_update', 'role_delete'])
const AFFECTED_USER_EVENTS: ReadonlySet<string> = new Set(['member_update', 'member_join', 'member_remove', 'member_ban', 'member_unban'])
const MAX_CONSECUTIVE_FAILURES = 3

const ADMINISTRATOR = 1n << 3n
const MANAGE_GUILD = 1n << 5n

const manages = (raw: string): boolean => {
  try {
    return (BigInt(raw) & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n
  } catch {
    return false
  }
}

export interface PermissionRefresher {
  start(): void
  stop(): void
  refreshUser(userId: string): Promise<void>
  refreshSession(session: Session): Promise<Session>
  idle(): Promise<void>
}

export const createPermissionRefresher = (d: {
  store: Store
  discord: Pick<DiscordPort, 'fetchMemberPermissions'>
  subscribe: (cb: (e: NormalizedEvent) => void) => () => void
  onDemoted: (userId: string, guildId: string, reason: string) => void
  now?: () => number
}): PermissionRefresher => {
  const now = d.now ?? Date.now
  let off: (() => void) | null = null
  let chain: Promise<void> = Promise.resolve()
  const failures = new Map<string, number>()

  const refreshSession = async (session: Session): Promise<Session> => {
    const guilds: Record<string, string> = {}
    for (const [guildId, current] of Object.entries(session.guilds)) {
      let fresh: string | null
      try {
        fresh = await d.discord.fetchMemberPermissions(guildId, session.userId)
      } catch (err) {
        if (err instanceof McpToolError && err.code === 'not_found') fresh = null
        else {
          const key = `${session.familyId}:${guildId}`
          const count = (failures.get(key) ?? 0) + 1
          if (count < MAX_CONSECUTIVE_FAILURES) {
            failures.set(key, count)
            guilds[guildId] = current
          } else {
            failures.delete(key)
            d.onDemoted(session.userId, guildId, `permissions could not be verified for guild ${guildId}`)
          }
          continue
        }
      }
      failures.delete(`${session.familyId}:${guildId}`)
      if (fresh !== null && manages(fresh)) {
        guilds[guildId] = fresh
      } else {
        d.onDemoted(session.userId, guildId, `lost management permissions in guild ${guildId}`)
      }
    }
    if (Object.keys(guilds).length === 0) {
      d.store.oauth.revokeFamily(session.familyId)
    } else {
      d.store.oauth.updateSessionGuilds(session.familyId, guilds)
    }
    return { ...session, guilds, revoked: Object.keys(guilds).length === 0 }
  }

  const refreshUser = async (userId: string): Promise<void> => {
    const t = now()
    const sessions = d.store.oauth.listSessionsForUser(userId).filter((s) => !s.revoked && s.refreshExpiresAt > t)
    for (const s of sessions) await refreshSession(s)
  }

  const onEvent = (e: NormalizedEvent): void => {
    const guildWide = GUILD_WIDE_EVENTS.has(e.type)
    const affected = AFFECTED_USER_EVENTS.has(e.type) && typeof e.data.user_id === 'string' ? e.data.user_id : null
    if (!guildWide && affected === null) return
    const users = new Set<string>()
    for (const s of d.store.oauth.listActiveSessions(now())) {
      if (e.guildId in s.guilds && (guildWide || s.userId === affected)) users.add(s.userId)
    }
    for (const userId of users) {
      chain = chain.then(() => refreshUser(userId)).catch(() => undefined)
    }
  }

  return {
    start() {
      if (off) return
      off = d.subscribe(onEvent)
    },
    stop() {
      off?.()
      off = null
    },
    refreshUser,
    refreshSession,
    idle: () => chain,
  }
}
