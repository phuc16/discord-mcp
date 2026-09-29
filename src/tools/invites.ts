import { z } from 'zod'
import type { AnyToolDef } from '../contracts/index.js'
import { assertChannelInGuild, assertInviteInGuild, auditReason, defineTool, defined, guildId, snowflake } from './define.js'

export const invitesList = defineTool({
  name: 'invites_list',
  group: 'invites',
  tier: 'read',
  description: 'List invites of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listInvites(i.guild_id) } }),
})

export const invitesCreate = defineTool({
  name: 'invites_create',
  group: 'invites',
  tier: 'write',
  description: 'Create an invite to a channel of the guild (write).',
  input: {
    guild_id: guildId,
    channel_id: snowflake,
    max_age: z.number().int().min(0).max(604800).optional(),
    max_uses: z.number().int().min(0).max(100).optional(),
    temporary: z.boolean().optional(),
    unique: z.boolean().optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, channel_id, ...spec }) => {
    await assertChannelInGuild(ctx, channel_id, guild_id)
    return { data: await ctx.discord.createInvite(channel_id, defined(spec), auditReason(ctx)) }
  },
})

export const invitesDelete = defineTool({
  name: 'invites_delete',
  group: 'invites',
  tier: 'destructive',
  description: 'Revoke an invite of the guild (destructive).',
  input: { guild_id: guildId, code: z.string().min(1).max(64) },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const invite = await assertInviteInGuild(ctx, i.code, i.guild_id)
    return {
      summary: `Revoke invite ${i.code} (${typeof invite.uses === 'number' ? invite.uses : 0} uses)`,
      affected: { invites: 1 },
    }
  },
  handler: async (ctx, i) => {
    await assertInviteInGuild(ctx, i.code, i.guild_id)
    return { data: await ctx.discord.deleteInvite(i.code, auditReason(ctx)) }
  },
})

export const invitesTools: AnyToolDef[] = [invitesList, invitesCreate, invitesDelete]
