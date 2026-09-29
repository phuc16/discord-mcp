import { z } from 'zod'
import type { AnyToolDef } from '../contracts/index.js'
import { assertChannelInGuild, auditReason, defineTool, guildId, snowflake } from './define.js'

export const membersList = defineTool({
  name: 'members_list',
  group: 'members',
  tier: 'read',
  description: 'List members of a guild, paged by user id (read).',
  input: { guild_id: guildId, limit: z.number().int().min(1).max(1000).default(100), after: snowflake.optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const items = await ctx.discord.listMembers(i.guild_id, i.after ? { limit: i.limit, after: i.after } : { limit: i.limit })
    const last = items[items.length - 1]
    const lastId = (last?.user as { id?: string } | undefined)?.id
    return { data: { items, next_cursor: items.length === i.limit ? lastId : undefined } }
  },
})

export const membersGet = defineTool({
  name: 'members_get',
  group: 'members',
  tier: 'read',
  description: 'Get one member of a guild (read).',
  input: { guild_id: guildId, user_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await ctx.discord.getMember(i.guild_id, i.user_id) }),
})

export const membersSearch = defineTool({
  name: 'members_search',
  group: 'members',
  tier: 'read',
  description: 'Search guild members by username or nickname prefix (read).',
  input: { guild_id: guildId, query: z.string().min(1).max(100), limit: z.number().int().min(1).max(100).default(20) },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.searchMembers(i.guild_id, i.query, i.limit) } }),
})

export const membersUpdateNick = defineTool({
  name: 'members_update_nick',
  group: 'members',
  tier: 'write',
  description: 'Set or clear a member nickname (write).',
  input: { guild_id: guildId, user_id: snowflake, nick: z.string().max(32).nullable() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id, { allowSelf: true })
    return { data: await ctx.discord.updateMember(i.guild_id, i.user_id, { nick: i.nick }, auditReason(ctx)) }
  },
})

export const membersAddRole = defineTool({
  name: 'members_add_role',
  group: 'members',
  tier: 'write',
  description: 'Add a role to a member (write).',
  input: { guild_id: guildId, user_id: snowflake, role_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnRole(i.guild_id, i.role_id)
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id, { allowSelf: true })
    await ctx.discord.addMemberRole(i.guild_id, i.user_id, i.role_id, auditReason(ctx))
    return { data: { user_id: i.user_id, role_id: i.role_id } }
  },
})

export const membersRemoveRole = defineTool({
  name: 'members_remove_role',
  group: 'members',
  tier: 'write',
  description: 'Remove a role from a member (write).',
  input: { guild_id: guildId, user_id: snowflake, role_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnRole(i.guild_id, i.role_id)
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id, { allowSelf: true })
    await ctx.discord.removeMemberRole(i.guild_id, i.user_id, i.role_id, auditReason(ctx))
    return { data: { user_id: i.user_id, role_id: i.role_id } }
  },
})

export const membersMoveVoice = defineTool({
  name: 'members_move_voice',
  group: 'members',
  tier: 'write',
  description: 'Move a member to another voice channel (write).',
  input: { guild_id: guildId, user_id: snowflake, channel_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id, { allowSelf: true })
    return { data: await ctx.discord.updateMember(i.guild_id, i.user_id, { channel_id: i.channel_id }, auditReason(ctx)) }
  },
})

export const membersDisconnectVoice = defineTool({
  name: 'members_disconnect_voice',
  group: 'members',
  tier: 'write',
  description: 'Disconnect a member from voice (write).',
  input: { guild_id: guildId, user_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id, { allowSelf: true })
    return { data: await ctx.discord.updateMember(i.guild_id, i.user_id, { channel_id: null }, auditReason(ctx)) }
  },
})

export const membersTools: AnyToolDef[] = [
  membersList,
  membersGet,
  membersSearch,
  membersUpdateNick,
  membersAddRole,
  membersRemoveRole,
  membersMoveVoice,
  membersDisconnectVoice,
]
