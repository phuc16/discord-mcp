import { z } from 'zod'
import { McpToolError, type AnyToolDef } from '../contracts/index.js'
import { assertChannelInGuild, auditReason, defineTool, defined, guildId, snowflake } from './define.js'

const isoTime = z.iso.datetime({ offset: true })
const entityType = z.union([z.literal(1), z.literal(2), z.literal(3)])
const entityMetadata = z.object({ location: z.string().min(1).max(100).optional() })
const eventId = { guild_id: guildId, event_id: snowflake }

export const seventsList = defineTool({
  name: 'sevents_list',
  group: 'scheduled_events',
  tier: 'read',
  description: 'List scheduled events of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listScheduledEvents(i.guild_id) } }),
})

export const seventsGet = defineTool({
  name: 'sevents_get',
  group: 'scheduled_events',
  tier: 'read',
  description: 'Get one scheduled event (read).',
  input: eventId,
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await ctx.discord.getScheduledEvent(i.guild_id, i.event_id) }),
})

export const seventsCreate = defineTool({
  name: 'sevents_create',
  group: 'scheduled_events',
  tier: 'write',
  description: 'Create a stage, voice or external scheduled event (write).',
  input: {
    guild_id: guildId,
    name: z.string().min(1).max(100),
    scheduled_start_time: isoTime,
    scheduled_end_time: isoTime.optional(),
    entity_type: entityType,
    channel_id: snowflake.optional(),
    entity_metadata: entityMetadata.optional(),
    description: z.string().max(1000).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    if (i.entity_type === 3 && (!i.scheduled_end_time || !i.entity_metadata?.location)) {
      throw new McpToolError('invalid_input', 'external events require scheduled_end_time and entity_metadata.location')
    }
    if (i.entity_type !== 3 && !i.channel_id) {
      throw new McpToolError('invalid_input', 'stage and voice events require channel_id')
    }
    if (i.channel_id) await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const { guild_id, ...rest } = i
    return { data: await ctx.discord.createScheduledEvent(guild_id, { ...defined(rest), privacy_level: 2 }, auditReason(ctx)) }
  },
})

export const seventsUpdate = defineTool({
  name: 'sevents_update',
  group: 'scheduled_events',
  tier: 'write',
  description: 'Update or change the status of a scheduled event (write).',
  input: {
    ...eventId,
    name: z.string().min(1).max(100).optional(),
    scheduled_start_time: isoTime.optional(),
    scheduled_end_time: isoTime.optional(),
    channel_id: snowflake.optional(),
    entity_metadata: entityMetadata.optional(),
    description: z.string().max(1000).optional(),
    status: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, event_id, ...patch }) => {
    if (patch.channel_id) await assertChannelInGuild(ctx, patch.channel_id, guild_id)
    return { data: await ctx.discord.updateScheduledEvent(guild_id, event_id, defined(patch), auditReason(ctx)) }
  },
})

export const seventsListUsers = defineTool({
  name: 'sevents_list_users',
  group: 'scheduled_events',
  tier: 'read',
  description: 'List users interested in a scheduled event (read).',
  input: { ...eventId, limit: z.number().int().min(1).max(100).default(100) },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listScheduledEventUsers(i.guild_id, i.event_id, i.limit) } }),
})

export const seventsDelete = defineTool({
  name: 'sevents_delete',
  group: 'scheduled_events',
  tier: 'destructive',
  description: 'Delete a scheduled event (destructive).',
  input: eventId,
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const ev = await ctx.discord.getScheduledEvent(i.guild_id, i.event_id)
    const users = typeof ev.user_count === 'number' ? ev.user_count : 0
    return {
      summary: `Delete scheduled event ${String(ev.name)} (${i.event_id})`,
      affected: { events: 1, interested_users: users },
    }
  },
  handler: async (ctx, i) => {
    await ctx.discord.deleteScheduledEvent(i.guild_id, i.event_id, auditReason(ctx))
    return { data: { event_id: i.event_id } }
  },
})

export const scheduledEventsTools: AnyToolDef[] = [
  seventsList,
  seventsGet,
  seventsCreate,
  seventsUpdate,
  seventsListUsers,
  seventsDelete,
]
