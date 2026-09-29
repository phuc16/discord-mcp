import { z } from 'zod'
import { McpToolError, type AnyToolDef } from '../contracts/index.js'
import { assertChannelInGuild, assertTagsNotDropped, assertOptionalChannelInGuild, auditReason, defineTool, defined, forumTag, guildId, snowflake } from './define.js'

const bits = z.string().regex(/^\d+$/, 'must be a decimal bit string')
const channelType = z.union([z.literal(0), z.literal(2), z.literal(4), z.literal(5), z.literal(13), z.literal(15)])

export const channelsList = defineTool({
  name: 'channels_list',
  group: 'channels',
  tier: 'read',
  description: 'List all channels of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listChannels(i.guild_id) } }),
})

export const channelsGet = defineTool({
  name: 'channels_get',
  group: 'channels',
  tier: 'read',
  description: 'Get one channel of a guild (read).',
  input: { guild_id: guildId, channel_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await assertChannelInGuild(ctx, i.channel_id, i.guild_id) }),
})

export const channelsCreate = defineTool({
  name: 'channels_create',
  group: 'channels',
  tier: 'write',
  description: 'Create a channel in a guild (write).',
  input: {
    guild_id: guildId,
    name: z.string().min(1).max(100),
    type: channelType,
    parent_id: snowflake.optional(),
    topic: z.string().max(1024).optional(),
    nsfw: z.boolean().optional(),
    position: z.number().int().min(0).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, ...spec }) => {
    await assertOptionalChannelInGuild(ctx, spec.parent_id, guild_id)
    return { data: await ctx.discord.createChannel(guild_id, defined(spec), auditReason(ctx)) }
  },
})

export const channelsUpdate = defineTool({
  name: 'channels_update',
  group: 'channels',
  tier: 'write',
  description: 'Update a channel of a guild (write).',
  input: {
    guild_id: guildId,
    channel_id: snowflake,
    name: z.string().min(1).max(100).optional(),
    topic: z.string().max(1024).nullable().optional(),
    nsfw: z.boolean().optional(),
    parent_id: snowflake.nullable().optional(),
    rate_limit_per_user: z.number().int().min(0).max(21600).optional(),
    available_tags: z.array(forumTag).max(20).optional(),
    allow_drop_tags: z.boolean().optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, channel_id, allow_drop_tags, ...patch }) => {
    const current = await assertChannelInGuild(ctx, channel_id, guild_id)
    if (patch.available_tags) assertTagsNotDropped(current.available_tags, patch.available_tags, allow_drop_tags)
    await assertOptionalChannelInGuild(ctx, patch.parent_id, guild_id)
    return { data: await ctx.discord.updateChannel(channel_id, defined(patch), auditReason(ctx)) }
  },
})

export const channelsMove = defineTool({
  name: 'channels_move',
  group: 'channels',
  tier: 'write',
  description: 'Reorder or re-parent channels of a guild (write).',
  input: {
    guild_id: guildId,
    positions: z
      .array(z.object({ id: snowflake, position: z.number().int().min(0), parent_id: snowflake.nullable().optional() }))
      .min(1)
      .max(50),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const known = new Set((await ctx.discord.listChannels(i.guild_id)).map((c) => c.id))
    for (const p of i.positions) {
      for (const ref of [p.id, p.parent_id]) {
        if (ref && !known.has(ref)) throw new McpToolError('not_found', `channel ${ref} not found in this guild`)
      }
    }
    await ctx.discord.moveChannels(i.guild_id, i.positions)
    return { data: { moved: i.positions.length } }
  },
})

export const channelsSetPermissions = defineTool({
  name: 'channels_set_permissions',
  group: 'channels',
  tier: 'write',
  description: 'Set a role or member permission overwrite on a channel (write).',
  input: {
    guild_id: guildId,
    channel_id: snowflake,
    overwrite_id: snowflake,
    type: z.union([z.literal(0), z.literal(1)]),
    allow: bits,
    deny: bits,
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    await ctx.discord.setChannelPermissions(i.channel_id, i.overwrite_id, { type: i.type, allow: i.allow, deny: i.deny }, auditReason(ctx))
    return { data: { channel_id: i.channel_id, overwrite_id: i.overwrite_id } }
  },
})

export const channelsDeletePermissions = defineTool({
  name: 'channels_delete_permissions',
  group: 'channels',
  tier: 'write',
  description: 'Remove a permission overwrite from a channel (write).',
  input: { guild_id: guildId, channel_id: snowflake, overwrite_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    await ctx.discord.deleteChannelPermissions(i.channel_id, i.overwrite_id, auditReason(ctx))
    return { data: { channel_id: i.channel_id, overwrite_id: i.overwrite_id } }
  },
})

export const channelsDelete = defineTool({
  name: 'channels_delete',
  group: 'channels',
  tier: 'destructive',
  description: 'Delete a channel and its messages permanently (destructive).',
  input: { guild_id: guildId, channel_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const ch = await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return {
      summary: `Delete channel #${String(ch.name)} (${i.channel_id})`,
      affected: { channels: 1 },
      details: { name: ch.name, type: ch.type },
    }
  },
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { data: await ctx.discord.deleteChannel(i.channel_id, auditReason(ctx)) }
  },
})

export const channelsClone = defineTool({
  name: 'channels_clone',
  group: 'channels',
  tier: 'write',
  description: 'Clone a channel with its type, topic, parent, position, limits, tags and permission overwrites (write).',
  input: { guild_id: guildId, channel_id: snowflake, name: z.string().min(1).max(100).optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const src = await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const spec = defined({
      name: i.name ?? src.name,
      type: src.type,
      topic: src.topic,
      parent_id: src.parent_id,
      nsfw: src.nsfw,
      permission_overwrites: src.permission_overwrites,
      bitrate: src.bitrate,
      user_limit: src.user_limit,
      rate_limit_per_user: src.rate_limit_per_user,
      available_tags: src.available_tags,
      position: src.position,
    })
    return { data: await ctx.discord.createChannel(i.guild_id, spec, auditReason(ctx)) }
  },
})

export const channelsTools: AnyToolDef[] = [
  channelsList,
  channelsGet,
  channelsCreate,
  channelsUpdate,
  channelsMove,
  channelsSetPermissions,
  channelsDeletePermissions,
  channelsDelete,
  channelsClone,
]
