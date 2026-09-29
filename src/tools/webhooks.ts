import { z } from 'zod'
import { McpToolError, type AnyToolDef, type Dto } from '../contracts/index.js'
import { assertChannelInGuild, assertWebhookInGuild, auditReason, defineTool, defined, guildId, snowflake } from './define.js'

const redact = (webhook: Dto): Dto =>
  Object.fromEntries(Object.entries(webhook).filter(([k]) => k !== 'token' && k !== 'url')) as Dto

export const webhooksList = defineTool({
  name: 'webhooks_list',
  group: 'webhooks',
  tier: 'read',
  description: 'List webhooks of a guild or one channel, without tokens (read).',
  input: { guild_id: guildId, channel_id: snowflake.optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    if (i.channel_id) await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const scope = i.channel_id ? { channelId: i.channel_id } : { guildId: i.guild_id }
    return { data: { items: (await ctx.discord.listWebhooks(scope)).map(redact) } }
  },
})

export const webhooksCreate = defineTool({
  name: 'webhooks_create',
  group: 'webhooks',
  tier: 'write',
  description: 'Create a webhook in a channel; the token is not returned (write).',
  input: { guild_id: guildId, channel_id: snowflake, name: z.string().min(1).max(80) },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { data: redact(await ctx.discord.createWebhook(i.channel_id, { name: i.name }, auditReason(ctx))) }
  },
})

export const webhooksUpdate = defineTool({
  name: 'webhooks_update',
  group: 'webhooks',
  tier: 'write',
  description: 'Rename a webhook or move it to another channel (write).',
  input: { guild_id: guildId, webhook_id: snowflake, name: z.string().min(1).max(80).optional(), channel_id: snowflake.optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertWebhookInGuild(ctx, i.webhook_id, i.guild_id)
    if (i.channel_id) await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    const patch = defined({ name: i.name, channel_id: i.channel_id })
    return { data: redact(await ctx.discord.updateWebhook(i.webhook_id, patch, auditReason(ctx))) }
  },
})

export const webhooksExecute = defineTool({
  name: 'webhooks_execute',
  group: 'webhooks',
  tier: 'write',
  description: 'Post a message through a webhook of this guild; mentions are suppressed (write).',
  input: { guild_id: guildId, webhook_id: snowflake, content: z.string().min(1).max(2000), username: z.string().min(1).max(80).optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const webhook = await assertWebhookInGuild(ctx, i.webhook_id, i.guild_id)
    if (typeof webhook.token !== 'string' || !webhook.token) {
      throw new McpToolError('invalid_input', 'webhook has no usable token; only webhooks created by this bot can be executed')
    }
    const body = defined({ content: i.content, username: i.username, allowed_mentions: { parse: [] } })
    const result = await ctx.discord.executeWebhook(i.webhook_id, webhook.token, body)
    return { data: result ? redact(result) : { sent: true } }
  },
})

export const webhooksDelete = defineTool({
  name: 'webhooks_delete',
  group: 'webhooks',
  tier: 'destructive',
  description: 'Delete a webhook permanently (destructive).',
  input: { guild_id: guildId, webhook_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const webhook = await assertWebhookInGuild(ctx, i.webhook_id, i.guild_id)
    return {
      summary: `Delete webhook ${String(webhook.name)} (${i.webhook_id})`,
      affected: { webhooks: 1 },
      details: { channel_id: webhook.channel_id },
    }
  },
  handler: async (ctx, i) => {
    await assertWebhookInGuild(ctx, i.webhook_id, i.guild_id)
    await ctx.discord.deleteWebhook(i.webhook_id, auditReason(ctx))
    return { data: { webhook_id: i.webhook_id } }
  },
})

export const webhooksTools: AnyToolDef[] = [webhooksList, webhooksCreate, webhooksUpdate, webhooksExecute, webhooksDelete]
