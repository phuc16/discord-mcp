import type { Tier } from '../contracts/index.js'

export const PERM = {
  ADMINISTRATOR: 1n << 3n,
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  MANAGE_CHANNELS: 1n << 4n,
  MOVE_MEMBERS: 1n << 24n,
  MANAGE_NICKNAMES: 1n << 27n,
  MANAGE_GUILD: 1n << 5n,
  VIEW_AUDIT_LOG: 1n << 7n,
  MANAGE_MESSAGES: 1n << 13n,
  MANAGE_ROLES: 1n << 28n,
  MANAGE_WEBHOOKS: 1n << 29n,
  MANAGE_GUILD_EXPRESSIONS: 1n << 30n,
  MANAGE_EVENTS: 1n << 33n,
  MANAGE_THREADS: 1n << 34n,
  MODERATE_MEMBERS: 1n << 40n,
}

const GROUP_PERMS: Record<string, bigint> = {
  guild: PERM.MANAGE_GUILD,
  channels: PERM.MANAGE_CHANNELS,
  threads: PERM.MANAGE_THREADS,
  roles: PERM.MANAGE_ROLES,
  members: PERM.MANAGE_ROLES,
  moderation: PERM.BAN_MEMBERS | PERM.KICK_MEMBERS | PERM.MODERATE_MEMBERS,
  messages: PERM.MANAGE_MESSAGES,
  webhooks: PERM.MANAGE_WEBHOOKS,
  scheduled_events: PERM.MANAGE_EVENTS,
  invites: PERM.MANAGE_GUILD,
  emojis: PERM.MANAGE_GUILD_EXPRESSIONS,
  audit_log: PERM.VIEW_AUDIT_LOG,
  meta: 0n,
}

export const KNOWN_GROUPS: readonly string[] = Object.keys(GROUP_PERMS)

const READ_ONLY_GROUPS: ReadonlySet<string> = new Set(['audit_log'])

const TOOL_PERMS: Record<string, bigint> = {
  members_update_nick: PERM.MANAGE_NICKNAMES,
  members_add_role: PERM.MANAGE_ROLES,
  members_remove_role: PERM.MANAGE_ROLES,
  members_move_voice: PERM.MOVE_MEMBERS,
  members_disconnect_voice: PERM.MOVE_MEMBERS,
  mod_timeout: PERM.MODERATE_MEMBERS,
  mod_remove_timeout: PERM.MODERATE_MEMBERS,
  mod_kick: PERM.KICK_MEMBERS,
  mod_ban: PERM.BAN_MEMBERS,
  mod_unban: PERM.BAN_MEMBERS,
  mod_bulk_ban: PERM.BAN_MEMBERS,
  mod_list_bans: PERM.BAN_MEMBERS,
  automod_list_rules: PERM.MANAGE_GUILD,
  automod_create_rule: PERM.MANAGE_GUILD,
  automod_update_rule: PERM.MANAGE_GUILD,
  automod_delete_rule: PERM.MANAGE_GUILD,
}

export const hasPermission = (bits: bigint, perm: bigint): boolean => (bits & PERM.ADMINISTRATOR) !== 0n || (bits & perm) === perm

export const tierFromDiscordPermissions = (bits: bigint, group: string, tool?: string): Tier => {
  if ((bits & PERM.ADMINISTRATOR) !== 0n) return 'destructive'
  const toolPerm = tool === undefined ? undefined : TOOL_PERMS[tool]
  if (toolPerm !== undefined) return (bits & toolPerm) !== 0n ? 'destructive' : 'read'
  const groupPerm = GROUP_PERMS[group] ?? 0n
  if ((bits & groupPerm) !== 0n) return READ_ONLY_GROUPS.has(group) ? 'read' : 'destructive'
  if ((bits & PERM.MANAGE_GUILD) !== 0n) return 'write'
  return 'read'
}
