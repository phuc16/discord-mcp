import { z } from 'zod'
import { McpToolError, type AnyToolDef, type ToolContext } from '../contracts/index.js'
import { assertChannelsInGuild, auditReason, defineTool, defined, guildId, reasonWith, snowflake } from './define.js'

const reason = z.string().min(1).max(200).optional()
const deleteSeconds = z.number().int().min(0).max(604800).optional()
const automodActions = z
  .array(z.object({ type: z.union([z.literal(1), z.literal(2), z.literal(3)]), metadata: z.record(z.string(), z.unknown()).optional() }))
  .min(1)
  .max(5)
const actionChannels = (actions: readonly { metadata?: Record<string, unknown> | undefined }[]): string[] =>
  actions.flatMap((a) => (typeof a.metadata?.channel_id === 'string' ? [a.metadata.channel_id] : []))
const uniq = (ids: readonly string[]): string[] => [...new Set(ids)]
const MEMBER_PROFILE_TRIGGER = 6
const triggerType = z.union([z.literal(1), z.literal(3), z.literal(4), z.literal(5), z.literal(6)])

const describeUser = async (ctx: ToolContext, gid: string, userId: string): Promise<string> => {
  try {
    const m = await ctx.discord.getMember(gid, userId)
    const user = m.user as { username?: string } | undefined
    const name = (typeof m.nick === 'string' && m.nick) || user?.username
    return name ? `${name} (${userId})` : userId
  } catch {
    return userId
  }
}

export const modTimeout = defineTool({
  name: 'mod_timeout',
  group: 'moderation',
  tier: 'write',
  description: 'Time out a member for a duration, up to 28 days (write).',
  input: { guild_id: guildId, user_id: snowflake, duration_seconds: z.number().int().min(1).max(2419200) },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id)
    const until = new Date(Date.now() + i.duration_seconds * 1000).toISOString()
    return {
      data: await ctx.discord.updateMember(i.guild_id, i.user_id, { communication_disabled_until: until }, auditReason(ctx)),
    }
  },
})

export const modRemoveTimeout = defineTool({
  name: 'mod_remove_timeout',
  group: 'moderation',
  tier: 'write',
  description: 'Remove a member timeout (write).',
  input: { guild_id: guildId, user_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id)
    return { data: await ctx.discord.updateMember(i.guild_id, i.user_id, { communication_disabled_until: null }, auditReason(ctx)) }
  },
})

export const modKick = defineTool({
  name: 'mod_kick',
  group: 'moderation',
  tier: 'destructive',
  description: 'Kick a member from the guild (destructive).',
  input: { guild_id: guildId, user_id: snowflake, reason },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id)
    return { summary: `Kick ${await describeUser(ctx, i.guild_id, i.user_id)}`, affected: { members: 1 } }
  },
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id)
    await ctx.discord.kickMember(i.guild_id, i.user_id, reasonWith(ctx, i.reason))
    return { data: { user_id: i.user_id } }
  },
})

export const modBan = defineTool({
  name: 'mod_ban',
  group: 'moderation',
  tier: 'destructive',
  description: 'Ban a user from the guild, optionally deleting recent messages (destructive).',
  input: { guild_id: guildId, user_id: snowflake, delete_message_seconds: deleteSeconds, reason },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id)
    return {
      summary: `Ban ${await describeUser(ctx, i.guild_id, i.user_id)}`,
      affected: { users: 1 },
      details: { delete_message_seconds: i.delete_message_seconds ?? 0 },
    }
  },
  handler: async (ctx, i) => {
    await ctx.guards.assertCanActOnMember(i.guild_id, i.user_id)
    await ctx.discord.banMember(i.guild_id, i.user_id, defined({ delete_message_seconds: i.delete_message_seconds }), reasonWith(ctx, i.reason))
    return { data: { user_id: i.user_id } }
  },
})

export const modUnban = defineTool({
  name: 'mod_unban',
  group: 'moderation',
  tier: 'write',
  description: 'Remove a ban (write).',
  input: { guild_id: guildId, user_id: snowflake, reason },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await ctx.discord.unbanMember(i.guild_id, i.user_id, reasonWith(ctx, i.reason))
    return { data: { user_id: i.user_id } }
  },
})

export const modBulkBan = defineTool({
  name: 'mod_bulk_ban',
  group: 'moderation',
  tier: 'destructive',
  description: 'Ban up to 200 users at once (destructive).',
  input: { guild_id: guildId, user_ids: z.array(snowflake).min(1).max(200), delete_message_seconds: deleteSeconds, reason },
  guildFrom: (i) => i.guild_id,
  preview: async (_ctx, i) => {
    const userIds = uniq(i.user_ids)
    return { summary: `Ban ${userIds.length} users`, affected: { users: userIds.length }, details: { user_ids: userIds } }
  },
  handler: async (ctx, i) => {
    const userIds = uniq(i.user_ids)
    for (const userId of userIds) await ctx.guards.assertCanActOnMember(i.guild_id, userId)
    return { data: await ctx.discord.bulkBan(i.guild_id, userIds, defined({ delete_message_seconds: i.delete_message_seconds }), reasonWith(ctx, i.reason)) }
  },
})

export const modListBans = defineTool({
  name: 'mod_list_bans',
  group: 'moderation',
  tier: 'read',
  description: 'List bans of a guild (read).',
  input: { guild_id: guildId, limit: z.number().int().min(1).max(1000).default(100), after: snowflake.optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const items = await ctx.discord.listBans(i.guild_id, i.after ? { limit: i.limit, after: i.after } : { limit: i.limit })
    const lastId = (items[items.length - 1]?.user as { id?: string } | undefined)?.id
    return { data: { items, next_cursor: items.length === i.limit ? lastId : undefined } }
  },
})

export const automodListRules = defineTool({
  name: 'automod_list_rules',
  group: 'moderation',
  tier: 'read',
  description: 'List auto-moderation rules of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listAutomodRules(i.guild_id) } }),
})

export const automodCreateRule = defineTool({
  name: 'automod_create_rule',
  group: 'moderation',
  tier: 'write',
  description: 'Create an auto-moderation rule (write).',
  input: {
    guild_id: guildId,
    name: z.string().min(1).max(100),
    event_type: z.union([z.literal(1), z.literal(2)]),
    trigger_type: triggerType,
    trigger_metadata: z.record(z.string(), z.unknown()).optional(),
    actions: automodActions,
    enabled: z.boolean().optional(),
    exempt_roles: z.array(snowflake).max(20).optional(),
    exempt_channels: z.array(snowflake).max(50).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, ...spec }) => {
    if ((spec.trigger_type === MEMBER_PROFILE_TRIGGER) !== (spec.event_type === 2)) {
      throw new McpToolError('invalid_input', 'event_type 2 (member update) is required for, and only valid with, trigger_type 6 (member profile)')
    }
    await assertChannelsInGuild(ctx, [...(spec.exempt_channels ?? []), ...actionChannels(spec.actions)], guild_id)
    return { data: await ctx.discord.createAutomodRule(guild_id, defined(spec), auditReason(ctx)) }
  },
})

export const automodUpdateRule = defineTool({
  name: 'automod_update_rule',
  group: 'moderation',
  tier: 'write',
  description: 'Update an auto-moderation rule (write).',
  input: {
    guild_id: guildId,
    rule_id: snowflake,
    name: z.string().min(1).max(100).optional(),
    trigger_metadata: z.record(z.string(), z.unknown()).optional(),
    actions: automodActions.optional(),
    enabled: z.boolean().optional(),
    exempt_roles: z.array(snowflake).max(20).optional(),
    exempt_channels: z.array(snowflake).max(50).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, rule_id, ...patch }) => {
    await assertChannelsInGuild(ctx, [...(patch.exempt_channels ?? []), ...actionChannels(patch.actions ?? [])], guild_id)
    return { data: await ctx.discord.updateAutomodRule(guild_id, rule_id, defined(patch), auditReason(ctx)) }
  },
})

export const automodDeleteRule = defineTool({
  name: 'automod_delete_rule',
  group: 'moderation',
  tier: 'destructive',
  description: 'Delete an auto-moderation rule (destructive).',
  input: { guild_id: guildId, rule_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const rule = (await ctx.discord.listAutomodRules(i.guild_id)).find((r) => r.id === i.rule_id)
    if (!rule) throw new McpToolError('not_found', `automod rule ${i.rule_id} not found in this guild`)
    return { summary: `Delete automod rule ${String(rule.name)} (${i.rule_id})`, affected: { rules: 1 } }
  },
  handler: async (ctx, i) => {
    await ctx.discord.deleteAutomodRule(i.guild_id, i.rule_id, auditReason(ctx))
    return { data: { rule_id: i.rule_id } }
  },
})

export const moderationTools: AnyToolDef[] = [
  modTimeout,
  modRemoveTimeout,
  modKick,
  modBan,
  modUnban,
  modBulkBan,
  modListBans,
  automodListRules,
  automodCreateRule,
  automodUpdateRule,
  automodDeleteRule,
]
