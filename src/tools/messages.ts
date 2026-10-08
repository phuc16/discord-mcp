import { z } from 'zod'
import { McpToolError, type AnyToolDef, type Dto, type ToolContext } from '../contracts/index.js'
import { assertChannelInGuild, auditReason, defineTool, defined, guildId, snowflake } from './define.js'

const PAGE = 100
const PURGE_SCAN_CAP = 5000
const BULK_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000
const DISCORD_EPOCH = 1420070400000n

const embeds = z.array(z.record(z.string(), z.unknown())).max(10)
const allowedMentions = z.object({
  parse: z.array(z.enum(['roles', 'users'])).optional(),
  users: z.array(snowflake).max(100).optional(),
  roles: z.array(snowflake).max(100).optional(),
  replied_user: z.boolean().optional(),
})
const channel = { guild_id: guildId, channel_id: snowflake }

const createdAtMs = (messageId: string): number => Number((BigInt(messageId) >> 22n) + DISCORD_EPOCH)

const authorOf = (m: Dto): { id?: string; username?: string } => (m.author ?? {}) as { id?: string; username?: string }

const scanChannel = async (
  ctx: ToolContext,
  channelId: string,
  opts: { before?: string; maxScan: number; want?: number; keep?: (m: Dto) => boolean; stopBefore?: number },
): Promise<{ matched: Dto[]; scanned: number; hitCutoff: boolean }> => {
  const matched: Dto[] = []
  let scanned = 0
  let cursor = opts.before
  let hitCutoff = false
  while (scanned < opts.maxScan && (opts.want === undefined || matched.length < opts.want)) {
    const limit = Math.min(PAGE, opts.maxScan - scanned)
    const page = await ctx.discord.listMessages(channelId, defined({ limit, before: cursor }) as { limit: number; before?: string })
    for (const m of page) {
      if (opts.stopBefore !== undefined && createdAtMs(m.id) <= opts.stopBefore) {
        hitCutoff = true
        break
      }
      scanned += 1
      if (!opts.keep || opts.keep(m)) matched.push(m)
      if (opts.want !== undefined && matched.length >= opts.want) break
    }
    const last = page[page.length - 1]
    if (hitCutoff || page.length < limit || !last) break
    cursor = last.id
  }
  return { matched, scanned, hitCutoff }
}

const purgeSet = async (ctx: ToolContext, i: { channel_id: string; limit: number; before: string; user_id?: string; contains?: string }) => {
  const needle = i.contains?.toLowerCase()
  const keep = (m: Dto): boolean =>
    (!i.user_id || authorOf(m).id === i.user_id) &&
    (!needle || (typeof m.content === 'string' && m.content.toLowerCase().includes(needle)))
  const { matched, scanned, hitCutoff } = await scanChannel(ctx, i.channel_id, {
    before: i.before,
    maxScan: PURGE_SCAN_CAP,
    want: i.limit,
    keep,
    stopBefore: Date.now() - BULK_MAX_AGE_MS,
  })
  return { deletable: matched, scanned, hitCutoff }
}

export const messagesList = defineTool({
  name: 'messages_list',
  group: 'messages',
  tier: 'read',
  description: 'List recent messages of a channel, newest first (read).',
  input: { ...channel, limit: z.number().int().min(1).max(100).default(50), before: snowflake.optional(), after: snowflake.optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const q = defined({ limit: i.limit, before: i.before, after: i.after }) as { limit: number; before?: string; after?: string }
    return { data: { items: await ctx.discord.listMessages(i.channel_id, q) } }
  },
})

export const messagesGet = defineTool({
  name: 'messages_get',
  group: 'messages',
  tier: 'read',
  description: 'Get one message of a channel (read).',
  input: { ...channel, message_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { data: await ctx.discord.getMessage(i.channel_id, i.message_id) }
  },
})

export const messagesSend = defineTool({
  name: 'messages_send',
  group: 'messages',
  tier: 'write',
  description: 'Send a message to a channel; mentions are suppressed unless allowed_mentions is set (write).',
  input: {
    ...channel,
    content: z.string().max(2000).optional(),
    embeds: embeds.optional(),
    reply_to: snowflake.optional(),
    allowed_mentions: allowedMentions.optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    if (!i.content && !i.embeds?.length) throw new McpToolError('invalid_input', 'content or embeds is required')
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const body = defined({
      content: i.content,
      embeds: i.embeds,
      message_reference: i.reply_to ? { message_id: i.reply_to } : undefined,
      allowed_mentions: i.allowed_mentions ?? { parse: [] },
    })
    return { data: await ctx.discord.sendMessage(i.channel_id, body) }
  },
})

export const messagesEdit = defineTool({
  name: 'messages_edit',
  group: 'messages',
  tier: 'write',
  description: 'Edit a message sent by the bot (write).',
  input: { ...channel, message_id: snowflake, content: z.string().max(2000).optional(), embeds: embeds.optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { data: await ctx.discord.editMessage(i.channel_id, i.message_id, defined({ content: i.content, embeds: i.embeds, allowed_mentions: { parse: [] } })) }
  },
})

export const messagesDelete = defineTool({
  name: 'messages_delete',
  group: 'messages',
  tier: 'destructive',
  description: 'Delete one message permanently (destructive).',
  input: { ...channel, message_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const m = await ctx.discord.getMessage(i.channel_id, i.message_id)
    const excerpt = typeof m.content === 'string' ? m.content.slice(0, 100) : ''
    return {
      summary: `Delete message ${i.message_id} by ${authorOf(m).username ?? authorOf(m).id ?? 'unknown'}: ${excerpt}`,
      affected: { messages: 1 },
    }
  },
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    await ctx.discord.deleteMessage(i.channel_id, i.message_id, auditReason(ctx))
    return { data: { message_id: i.message_id } }
  },
})

export const messagesPurge = defineTool({
  name: 'messages_purge',
  group: 'messages',
  tier: 'destructive',
  description: 'Bulk delete up to 1000 messages older than the required `before` message id (exclusive; take the newest id from messages_list so the set is pinned and later messages are never touched), optionally by author or text; scanning stops at messages older than 14 days (destructive).',
  input: {
    ...channel,
    limit: z.number().int().min(1).max(1000),
    before: snowflake,
    user_id: snowflake.optional(),
    contains: z.string().min(1).max(200).optional(),
  },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const { deletable, scanned, hitCutoff } = await purgeSet(ctx, i)
    return {
      summary: `Delete ${deletable.length} messages older than ${i.before} in channel ${i.channel_id}`,
      affected: { messages: deletable.length },
      details: { scanned, before: i.before, stopped_at_14_day_cutoff: hitCutoff },
    }
  },
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const { deletable, hitCutoff } = await purgeSet(ctx, i)
    const ids = deletable.map((m) => m.id)
    for (let at = 0; at < ids.length; at += PAGE) {
      const chunk = ids.slice(at, at + PAGE)
      if (chunk.length === 1 && chunk[0]) await ctx.discord.deleteMessage(i.channel_id, chunk[0], auditReason(ctx))
      else await ctx.discord.bulkDeleteMessages(i.channel_id, chunk, auditReason(ctx))
    }
    return { data: { deleted: ids.length, stopped_at_14_day_cutoff: hitCutoff } }
  },
})

export const messagesPin = defineTool({
  name: 'messages_pin',
  group: 'messages',
  tier: 'write',
  description: 'Pin a message (write).',
  input: { ...channel, message_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    await ctx.discord.pinMessage(i.channel_id, i.message_id, auditReason(ctx))
    return { data: { message_id: i.message_id } }
  },
})

export const messagesUnpin = defineTool({
  name: 'messages_unpin',
  group: 'messages',
  tier: 'write',
  description: 'Unpin a message (write).',
  input: { ...channel, message_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    await ctx.discord.unpinMessage(i.channel_id, i.message_id, auditReason(ctx))
    return { data: { message_id: i.message_id } }
  },
})

export const messagesListPins = defineTool({
  name: 'messages_list_pins',
  group: 'messages',
  tier: 'read',
  description: 'List pinned messages of a channel (read).',
  input: channel,
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { data: { items: await ctx.discord.listPins(i.channel_id) } }
  },
})

export const messagesCrosspost = defineTool({
  name: 'messages_crosspost',
  group: 'messages',
  tier: 'write',
  description: 'Publish a message of an announcement channel to followers (write).',
  input: { ...channel, message_id: snowflake },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { data: await ctx.discord.crosspostMessage(i.channel_id, i.message_id) }
  },
})

export const reactionsAdd = defineTool({
  name: 'reactions_add',
  group: 'messages',
  tier: 'write',
  description: 'Add a reaction as the bot; emoji is a unicode character or name:id (write).',
  input: { ...channel, message_id: snowflake, emoji: z.string().min(1).max(100) },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    await ctx.discord.addReaction(i.channel_id, i.message_id, i.emoji)
    return { data: { message_id: i.message_id, emoji: i.emoji } }
  },
})

export const reactionsRemove = defineTool({
  name: 'reactions_remove',
  group: 'messages',
  tier: 'write',
  description: 'Remove the bot reaction, or that of a given user (write).',
  input: { ...channel, message_id: snowflake, emoji: z.string().min(1).max(100), user_id: snowflake.optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    if (i.user_id) await ctx.discord.removeReaction(i.channel_id, i.message_id, i.emoji, i.user_id)
    else await ctx.discord.removeReaction(i.channel_id, i.message_id, i.emoji)
    return { data: { message_id: i.message_id, emoji: i.emoji } }
  },
})

export const reactionsClear = defineTool({
  name: 'reactions_clear',
  group: 'messages',
  tier: 'destructive',
  description: 'Remove all reactions from a message (destructive).',
  input: { ...channel, message_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const m = await ctx.discord.getMessage(i.channel_id, i.message_id)
    const reactions = Array.isArray(m.reactions) ? (m.reactions as { count?: number }[]) : []
    const total = reactions.reduce((sum, r) => sum + (r.count ?? 0), 0)
    return { summary: `Clear ${total} reactions from message ${i.message_id}`, affected: { reactions: total } }
  },
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    await ctx.discord.clearReactions(i.channel_id, i.message_id)
    return { data: { message_id: i.message_id } }
  },
})

export const messagesSearch = defineTool({
  name: 'messages_search',
  group: 'messages',
  tier: 'read',
  description: 'Search recent messages of a channel by text and author by scanning history client-side (read).',
  input: {
    ...channel,
    query: z.string().min(1).max(200),
    author_id: snowflake.optional(),
    max_scan: z.number().int().min(1).max(500).default(200),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const needle = i.query.toLowerCase()
    const { matched, scanned } = await scanChannel(ctx, i.channel_id, {
      maxScan: i.max_scan,
      keep: (m) =>
        (!i.author_id || authorOf(m).id === i.author_id) &&
        typeof m.content === 'string' &&
        m.content.toLowerCase().includes(needle),
    })
    return { data: { items: matched, scanned } }
  },
})

export const messagesTools: AnyToolDef[] = [
  messagesList,
  messagesGet,
  messagesSend,
  messagesEdit,
  messagesDelete,
  messagesPurge,
  messagesPin,
  messagesUnpin,
  messagesListPins,
  messagesCrosspost,
  reactionsAdd,
  reactionsRemove,
  reactionsClear,
  messagesSearch,
]
