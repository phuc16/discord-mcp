import { z } from 'zod'
import {
  McpToolError,
  type AnyToolDef,
  type Dto,
  type Payload,
  type PreviewResult,
  type Tier,
  type ToolContext,
  type ToolResult,
} from '../contracts/index.js'

export const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake')
export const guildId = snowflake.describe('Target guild id')

export const defineTool = <S extends z.ZodRawShape>(def: {
  name: string
  group: string
  description: string
  tier: Tier
  unscoped?: boolean
  input: S
  guildFrom: (i: z.infer<z.ZodObject<S>>) => string | null
  preview?: (ctx: ToolContext, i: z.infer<z.ZodObject<S>>) => Promise<PreviewResult>
  handler: (ctx: ToolContext, i: z.infer<z.ZodObject<S>>) => Promise<ToolResult>
}): AnyToolDef => {
  if (def.unscoped && def.tier !== 'read') {
    throw new Error(`tool ${def.name}: unscoped tools must be read tier`)
  }
  if (def.tier === 'destructive' && !def.preview) {
    throw new Error(`tool ${def.name}: destructive tools must implement preview`)
  }
  return { ...def, input: z.object(def.input) } as unknown as AnyToolDef
}

export const auditReason = (ctx: ToolContext): string =>
  `via discord-mcp by ${ctx.principal.userName} (${ctx.correlationId})`

const notFound = (what: string, id: string): McpToolError => new McpToolError('not_found', `${what} ${id} not found in this guild`)

export const assertChannelInGuild = async (ctx: ToolContext, channelId: string, gid: string): Promise<Dto> => {
  const channel = await ctx.discord.getChannel(channelId)
  if (channel.guild_id !== gid) throw notFound('channel', channelId)
  return channel
}

export const assertWebhookInGuild = async (ctx: ToolContext, webhookId: string, gid: string): Promise<Dto> => {
  const webhooks = await ctx.discord.listWebhooks({ guildId: gid })
  const webhook = webhooks.find((w) => w.id === webhookId)
  if (!webhook || (webhook.guild_id !== undefined && webhook.guild_id !== gid)) throw notFound('webhook', webhookId)
  return webhook
}

export const assertInviteInGuild = async (ctx: ToolContext, code: string, gid: string): Promise<Payload> => {
  const invites = await ctx.discord.listInvites(gid)
  const invite = invites.find((i) => i.code === code)
  if (!invite) throw notFound('invite', code)
  return invite
}

export const defined = (o: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined))

export const reasonWith = (ctx: ToolContext, reason?: string): string =>
  reason ? `${auditReason(ctx)}: ${reason}` : auditReason(ctx)
