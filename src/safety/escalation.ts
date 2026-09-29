import { McpToolError } from '../contracts/index.js'
import type { DiscordPort, Principal } from '../contracts/index.js'
import { PERM } from './permissions.js'

export interface HierarchyContext {
  discord: Pick<DiscordPort, 'getGuild' | 'getMember' | 'listRoles'>
  principal: Principal
}

const toBits = (raw: bigint | string | number): bigint => {
  try {
    return BigInt(raw)
  } catch {
    throw new McpToolError('invalid_input', 'permission bits must be an integer bitfield')
  }
}

const heldBits = (principal: Principal, guildId: string): bigint => {
  const raw = principal.guilds[guildId]
  if (raw === undefined) return 0n
  try {
    return BigInt(raw)
  } catch {
    return 0n
  }
}

export const assertCanGrantPermissions = (principal: Principal, guildId: string, bits: bigint | string | number): void => {
  if (principal.kind !== 'user') return
  const requested = toBits(bits)
  const held = heldBits(principal, guildId)
  if ((held & PERM.ADMINISTRATOR) !== 0n) return
  const missing = requested & ~held
  if (missing !== 0n) {
    throw new McpToolError('missing_permissions', 'cannot grant permissions you do not hold', { missing: missing.toString() })
  }
}

interface Standing {
  owner: boolean
  position: number
}

const standingOf = async (ctx: HierarchyContext, guildId: string, userId: string): Promise<Standing> => {
  const [guild, member, roles] = await Promise.all([
    ctx.discord.getGuild(guildId),
    ctx.discord.getMember(guildId, userId),
    ctx.discord.listRoles(guildId),
  ])
  const owner = guild.owner_id === userId
  const held = new Set(Array.isArray(member.roles) ? (member.roles as unknown[]).filter((r): r is string => typeof r === 'string') : [])
  let position = 0
  for (const r of roles) {
    if (held.has(r.id) && typeof r.position === 'number' && r.position > position) position = r.position
  }
  return { owner, position }
}

const callerStanding = async (ctx: HierarchyContext, guildId: string): Promise<Standing | null> => {
  if (ctx.principal.kind !== 'user') return null
  if (ctx.principal.userId === null) throw new McpToolError('unauthorized', 'user principal without id')
  return standingOf(ctx, guildId, ctx.principal.userId)
}

export const callerHighestPosition = async (ctx: HierarchyContext, guildId: string): Promise<number> => {
  const s = await callerStanding(ctx, guildId)
  return s === null || s.owner ? Number.POSITIVE_INFINITY : s.position
}

const deny = (what: string, details: Record<string, unknown>): never => {
  throw new McpToolError('missing_permissions', `cannot act on ${what} at or above your highest role`, details)
}

export const assertCanPlaceRole = async (ctx: HierarchyContext, guildId: string, position: number): Promise<void> => {
  const highest = await callerHighestPosition(ctx, guildId)
  if (position >= highest) deny('a role position', { position })
}

export const assertCanActOnRole = async (ctx: HierarchyContext, guildId: string, roleId: string): Promise<void> => {
  const caller = await callerStanding(ctx, guildId)
  if (caller === null || caller.owner) return
  const roles = await ctx.discord.listRoles(guildId)
  const role = roles.find((r) => r.id === roleId)
  if (!role) throw new McpToolError('not_found', `role ${roleId} not found`)
  const position = typeof role.position === 'number' ? role.position : 0
  if (position >= caller.position) deny('a role', { role_id: roleId })
}

export const assertCanActOnMember = async (
  ctx: HierarchyContext,
  guildId: string,
  targetUserId: string,
  opts: { allowSelf?: boolean } = {},
): Promise<void> => {
  const caller = await callerStanding(ctx, guildId)
  if (caller === null) return
  if (targetUserId === ctx.principal.userId) {
    if (opts.allowSelf === true) return
    deny('yourself', { user_id: targetUserId })
  }
  if (caller.owner) return
  const target = await standingOf(ctx, guildId, targetUserId)
  if (target.owner || target.position >= caller.position) deny('a member', { user_id: targetUserId })
}
