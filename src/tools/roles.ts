import { z } from 'zod'
import { McpToolError, type AnyToolDef, type Dto, type ToolContext } from '../contracts/index.js'
import { auditReason, defineTool, defined, guildId, memberUserId, snowflake } from './define.js'

const bits = z.string().regex(/^\d+$/, 'must be a decimal bit string')
const roleFields = {
  name: z.string().min(1).max(100).optional(),
  color: z.number().int().min(0).max(0xffffff).optional(),
  permissions: bits.optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
}

const HOLDER_SCAN_PAGES = 5
const HOLDER_SCAN_PAGE = 1000

const findRole = async (ctx: ToolContext, gid: string, roleId: string): Promise<Dto> => {
  const role = (await ctx.discord.listRoles(gid)).find((r) => r.id === roleId)
  if (!role) throw new McpToolError('not_found', `role ${roleId} not found in this guild`)
  return role
}

export const rolesList = defineTool({
  name: 'roles_list',
  group: 'roles',
  tier: 'read',
  description: 'List roles of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listRoles(i.guild_id) } }),
})

export const rolesGet = defineTool({
  name: 'roles_get',
  group: 'roles',
  tier: 'read',
  description: 'Get one role of a guild (read).',
  input: { guild_id: guildId, role_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await findRole(ctx, i.guild_id, i.role_id) }),
})

export const rolesCreate = defineTool({
  name: 'roles_create',
  group: 'roles',
  tier: 'write',
  description: 'Create a role in a guild (write).',
  input: { guild_id: guildId, ...roleFields },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, ...spec }) => {
    if (spec.permissions !== undefined) ctx.guards.assertCanGrantPermissions(guild_id, spec.permissions)
    return { data: await ctx.discord.createRole(guild_id, defined(spec), auditReason(ctx)) }
  },
})

export const rolesUpdate = defineTool({
  name: 'roles_update',
  group: 'roles',
  tier: 'write',
  description: 'Update a role of a guild (write).',
  input: { guild_id: guildId, role_id: snowflake, ...roleFields },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, role_id, ...patch }) => {
    if (patch.permissions !== undefined) ctx.guards.assertCanGrantPermissions(guild_id, patch.permissions)
    await ctx.guards.assertCanActOnRole(guild_id, role_id)
    return { data: await ctx.discord.updateRole(guild_id, role_id, defined(patch), auditReason(ctx)) }
  },
})

export const rolesReorder = defineTool({
  name: 'roles_reorder',
  group: 'roles',
  tier: 'write',
  description: 'Change role positions in a guild (write).',
  input: {
    guild_id: guildId,
    positions: z.array(z.object({ id: snowflake, position: z.number().int().min(0) })).min(1).max(50),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    for (const p of i.positions) {
      await ctx.guards.assertCanActOnRole(i.guild_id, p.id)
      await ctx.guards.assertCanPlaceRole(i.guild_id, p.position)
    }
    return { data: { items: await ctx.discord.reorderRoles(i.guild_id, i.positions) } }
  },
})

export const rolesAssign = defineTool({
  name: 'roles_assign',
  group: 'roles',
  tier: 'write',
  description: 'Give a role to a member (write).',
  input: { guild_id: guildId, user_id: snowflake, role_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnRole(i.guild_id, i.role_id)
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id, { allowSelf: true })
    await ctx.discord.addMemberRole(i.guild_id, i.user_id, i.role_id, auditReason(ctx))
    return { data: { user_id: i.user_id, role_id: i.role_id } }
  },
})

export const rolesRemove = defineTool({
  name: 'roles_remove',
  group: 'roles',
  tier: 'write',
  description: 'Take a role from a member (write).',
  input: { guild_id: guildId, user_id: snowflake, role_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnRole(i.guild_id, i.role_id)
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id, { allowSelf: true })
    await ctx.discord.removeMemberRole(i.guild_id, i.user_id, i.role_id, auditReason(ctx))
    return { data: { user_id: i.user_id, role_id: i.role_id } }
  },
})

export const rolesBulkAssign = defineTool({
  name: 'roles_bulk_assign',
  group: 'roles',
  tier: 'destructive',
  description: 'Give a role to up to 200 members at once (destructive).',
  input: { guild_id: guildId, role_id: snowflake, user_ids: z.array(snowflake).min(1).max(200) },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const role = await findRole(ctx, i.guild_id, i.role_id)
    const count = new Set(i.user_ids).size
    return { summary: `Assign role ${String(role.name)} (${i.role_id}) to ${count} members`, affected: { members: count } }
  },
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnRole(i.guild_id, i.role_id)
    const ok: string[] = []
    const failed: { user_id: string; code: string }[] = []
    for (const userId of new Set(i.user_ids)) {
      try {
        await ctx.guards.assertCanActOnMember(i.guild_id, userId, { allowSelf: true })
        await ctx.discord.addMemberRole(i.guild_id, userId, i.role_id, auditReason(ctx))
        ok.push(userId)
      } catch (e) {
        failed.push({ user_id: userId, code: e instanceof McpToolError ? e.code : 'internal' })
      }
    }
    if (ok.length === 0) throw new McpToolError('internal', `role assignment failed for all ${failed.length} members: ${failed.map((f) => `${f.user_id}=${f.code}`).join(', ')}`)
    return failed.length > 0 ? { data: { ok, failed }, partial: true } : { data: { ok, failed } }
  },
})

export const rolesDelete = defineTool({
  name: 'roles_delete',
  group: 'roles',
  tier: 'destructive',
  description: 'Delete a role permanently (destructive).',
  input: { guild_id: guildId, role_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const role = await findRole(ctx, i.guild_id, i.role_id)
    let holders = 0
    let scanned = 0
    let after: string | undefined
    let truncated = false
    for (let page = 0; page < HOLDER_SCAN_PAGES; page += 1) {
      const members = await ctx.discord.listMembers(i.guild_id, after ? { limit: HOLDER_SCAN_PAGE, after } : { limit: HOLDER_SCAN_PAGE })
      scanned += members.length
      holders += members.filter((m) => Array.isArray(m.roles) && m.roles.includes(i.role_id)).length
      const last = members[members.length - 1]
      if (members.length < HOLDER_SCAN_PAGE || !last) break
      after = memberUserId(last)
      truncated = page === HOLDER_SCAN_PAGES - 1
    }
    return {
      summary: `Delete role ${String(role.name)} (${i.role_id}) held by ${truncated ? 'at least ' : ''}${holders} of ${scanned} members scanned`,
      affected: { members: holders },
      details: { scanned, at_least: truncated },
    }
  },
  handler: async (ctx, i) => {
    await ctx.discord.deleteRole(i.guild_id, i.role_id, auditReason(ctx))
    return { data: { role_id: i.role_id } }
  },
})

export const rolesTools: AnyToolDef[] = [
  rolesList,
  rolesGet,
  rolesCreate,
  rolesUpdate,
  rolesReorder,
  rolesAssign,
  rolesRemove,
  rolesBulkAssign,
  rolesDelete,
]
