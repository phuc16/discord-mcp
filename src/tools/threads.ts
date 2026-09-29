import { z } from 'zod'
import type { AnyToolDef } from '../contracts/index.js'
import { assertChannelInGuild, assertTagsNotDropped, auditReason, defineTool, defined, forumTag, guildId, snowflake } from './define.js'

const archiveDuration = z.union([z.literal(60), z.literal(1440), z.literal(4320), z.literal(10080)])

export const threadsListActive = defineTool({
  name: 'threads_list_active',
  group: 'threads',
  tier: 'read',
  description: 'List active threads of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listActiveThreads(i.guild_id) } }),
})

export const threadsListArchived = defineTool({
  name: 'threads_list_archived',
  group: 'threads',
  tier: 'read',
  description: 'List archived public or private threads of a channel (read).',
  input: {
    guild_id: guildId,
    channel_id: snowflake,
    kind: z.enum(['public', 'private']),
    before: z.string().datetime({ offset: true }).optional(),
    limit: z.number().int().min(1).max(100).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, channel_id, ...q }) => {
    await assertChannelInGuild(ctx, channel_id, guild_id)
    return { data: { items: await ctx.discord.listArchivedThreads(channel_id, defined(q) as typeof q) } }
  },
})

export const threadsCreate = defineTool({
  name: 'threads_create',
  group: 'threads',
  tier: 'write',
  description: 'Create a thread in a channel, optionally from a message (write).',
  input: {
    guild_id: guildId,
    channel_id: snowflake,
    name: z.string().min(1).max(100),
    message_id: snowflake.optional(),
    type: z.union([z.literal(11), z.literal(12)]).optional(),
    auto_archive_duration: archiveDuration.optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, channel_id, ...spec }) => {
    await assertChannelInGuild(ctx, channel_id, guild_id)
    return { data: await ctx.discord.createThread(channel_id, defined(spec.message_id ? spec : { ...spec, type: spec.type ?? 11 }), auditReason(ctx)) }
  },
})

export const threadsUpdate = defineTool({
  name: 'threads_update',
  group: 'threads',
  tier: 'write',
  description: 'Rename, archive or lock a thread (write).',
  input: {
    guild_id: guildId,
    thread_id: snowflake,
    name: z.string().min(1).max(100).optional(),
    archived: z.boolean().optional(),
    locked: z.boolean().optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, thread_id, ...patch }) => {
    await assertChannelInGuild(ctx, thread_id, guild_id)
    return { data: await ctx.discord.updateChannel(thread_id, defined(patch), auditReason(ctx)) }
  },
})

export const threadsAddMember = defineTool({
  name: 'threads_add_member',
  group: 'threads',
  tier: 'write',
  description: 'Add a user to a thread (write).',
  input: { guild_id: guildId, thread_id: snowflake, user_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.thread_id, i.guild_id)
    await ctx.discord.addThreadMember(i.thread_id, i.user_id)
    return { data: { thread_id: i.thread_id, user_id: i.user_id } }
  },
})

export const threadsRemoveMember = defineTool({
  name: 'threads_remove_member',
  group: 'threads',
  tier: 'write',
  description: 'Remove a user from a thread (write).',
  input: { guild_id: guildId, thread_id: snowflake, user_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.thread_id, i.guild_id)
    await ctx.discord.removeThreadMember(i.thread_id, i.user_id)
    return { data: { thread_id: i.thread_id, user_id: i.user_id } }
  },
})

export const threadsDelete = defineTool({
  name: 'threads_delete',
  group: 'threads',
  tier: 'destructive',
  description: 'Delete a thread and its messages permanently (destructive).',
  input: { guild_id: guildId, thread_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const th = await assertChannelInGuild(ctx, i.thread_id, i.guild_id)
    const messages = typeof th.message_count === 'number' ? th.message_count : 0
    return {
      summary: `Delete thread ${String(th.name)} (${i.thread_id}) with ${messages} messages`,
      affected: { threads: 1, messages },
    }
  },
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.thread_id, i.guild_id)
    return { data: await ctx.discord.deleteChannel(i.thread_id, auditReason(ctx)) }
  },
})

export const forumCreatePost = defineTool({
  name: 'forum_create_post',
  group: 'threads',
  tier: 'write',
  description: 'Create a post in a forum channel (write).',
  input: {
    guild_id: guildId,
    channel_id: snowflake,
    name: z.string().min(1).max(100),
    content: z.string().min(1).max(2000),
    applied_tags: z.array(snowflake).max(5).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const spec = defined({ name: i.name, applied_tags: i.applied_tags, message: { content: i.content, allowed_mentions: { parse: [] } } })
    return { data: await ctx.discord.createForumPost(i.channel_id, spec, auditReason(ctx)) }
  },
})

export const forumListTags = defineTool({
  name: 'forum_list_tags',
  group: 'threads',
  tier: 'read',
  description: 'List the available tags of a forum channel (read).',
  input: { guild_id: guildId, channel_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const ch = await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { data: { items: Array.isArray(ch.available_tags) ? ch.available_tags : [] } }
  },
})

export const forumUpdateTags = defineTool({
  name: 'forum_update_tags',
  group: 'threads',
  tier: 'write',
  description: 'Replace the available tags of a forum channel; pass tags exactly as returned by forum_list_tags (with ids) to keep them, tags omitted are deleted only with allow_drop_tags (write).',
  input: { guild_id: guildId, channel_id: snowflake, tags: z.array(forumTag).max(20), allow_drop_tags: z.boolean().optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const ch = await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    assertTagsNotDropped(ch.available_tags, i.tags, i.allow_drop_tags)
    return { data: await ctx.discord.updateChannel(i.channel_id, { available_tags: i.tags }, auditReason(ctx)) }
  },
})

export const threadsTools: AnyToolDef[] = [
  threadsListActive,
  threadsListArchived,
  threadsCreate,
  threadsUpdate,
  threadsAddMember,
  threadsRemoveMember,
  threadsDelete,
  forumCreatePost,
  forumListTags,
  forumUpdateTags,
]
