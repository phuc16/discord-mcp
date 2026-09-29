import { z } from 'zod'
import type { AnyToolDef } from '../contracts/index.js'
import { auditReason, defineTool, guildId, snowflake } from './define.js'

const days = z.number().int().min(1).max(30).describe('Days of inactivity')

const defined = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

export const guildList = defineTool({
  name: 'guild_list',
  group: 'guild',
  tier: 'read',
  unscoped: true,
  description: 'List guilds the bot is in that are allowed by policy (read).',
  input: {},
  guildFrom: () => null,
  handler: async (ctx) => {
    const allowed = new Set(Object.keys(ctx.services.policy.effective(ctx.principal).guilds))
    const guilds = await ctx.discord.listGuilds()
    return { data: { items: guilds.filter((g) => allowed.has(g.id)) } }
  },
})

export const guildGet = defineTool({
  name: 'guild_get',
  group: 'guild',
  tier: 'read',
  description: 'Get details of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await ctx.discord.getGuild(i.guild_id) }),
})

export const guildUpdate = defineTool({
  name: 'guild_update',
  group: 'guild',
  tier: 'write',
  description: 'Update guild name, description, verification level or system channel (write).',
  input: {
    guild_id: guildId,
    name: z.string().min(2).max(100).optional(),
    description: z.string().max(300).nullable().optional(),
    verification_level: z.number().int().min(0).max(4).optional(),
    system_channel_id: snowflake.nullable().optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, ...patch }) => ({
    data: await ctx.discord.updateGuild(guild_id, defined(patch), auditReason(ctx)),
  }),
})

export const guildGetPreview = defineTool({
  name: 'guild_get_preview',
  group: 'guild',
  tier: 'read',
  description: 'Get the public preview of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await ctx.discord.getGuildPreview(i.guild_id) }),
})

export const guildGetPruneCount = defineTool({
  name: 'guild_get_prune_count',
  group: 'guild',
  tier: 'read',
  description: 'Count members that a prune of the given inactivity would remove (read).',
  input: { guild_id: guildId, days },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await ctx.discord.getPruneCount(i.guild_id, i.days) }),
})

export const guildPrune = defineTool({
  name: 'guild_prune',
  group: 'guild',
  tier: 'destructive',
  description: 'Kick members inactive for the given number of days (destructive).',
  input: { guild_id: guildId, days },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const { pruned } = await ctx.discord.getPruneCount(i.guild_id, i.days)
    return {
      summary: `Prune ${pruned} members inactive for ${i.days} days`,
      affected: { members: pruned },
    }
  },
  handler: async (ctx, i) => ({ data: await ctx.discord.pruneGuild(i.guild_id, i.days, auditReason(ctx)) }),
})

export const guildGetWidget = defineTool({
  name: 'guild_get_widget',
  group: 'guild',
  tier: 'read',
  description: 'Get the guild widget settings (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await ctx.discord.getWidget(i.guild_id) }),
})

export const guildUpdateWidget = defineTool({
  name: 'guild_update_widget',
  group: 'guild',
  tier: 'write',
  description: 'Update the guild widget settings (write).',
  input: { guild_id: guildId, enabled: z.boolean().optional(), channel_id: snowflake.nullable().optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, ...patch }) => ({ data: await ctx.discord.updateWidget(guild_id, defined(patch)) }),
})

export const guildTools: AnyToolDef[] = [
  guildList,
  guildGet,
  guildUpdate,
  guildGetPreview,
  guildGetPruneCount,
  guildPrune,
  guildGetWidget,
  guildUpdateWidget,
]
