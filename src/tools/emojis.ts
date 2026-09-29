import { z } from 'zod'
import { McpToolError, type AnyToolDef, type Dto, type ToolContext } from '../contracts/index.js'
import { auditReason, defineTool, defined, guildId, snowflake } from './define.js'

const EMOJI_MAX_BYTES = 256 * 1024
const STICKER_MAX_BYTES = 512 * 1024
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

const imageDataUri = z
  .string()
  .regex(/^data:image\/(png|jpeg|gif);base64,[A-Za-z0-9+/]+={0,2}$/, 'must be a base64 png, jpeg or gif data URI')
  .refine((v) => Buffer.byteLength(v.slice(v.indexOf(',') + 1), 'base64') <= EMOJI_MAX_BYTES, 'image must be at most 256 KB')

const stickerFile = z
  .string()
  .regex(BASE64, 'must be base64')
  .refine((v) => Buffer.byteLength(v, 'base64') <= STICKER_MAX_BYTES, 'file must be at most 512 KB')

const findNamed = async (
  ctx: ToolContext,
  kind: 'emoji' | 'sticker',
  gid: string,
  itemId: string,
): Promise<Dto> => {
  const items = kind === 'emoji' ? await ctx.discord.listEmojis(gid) : await ctx.discord.listStickers(gid)
  const found = items.find((x) => x.id === itemId)
  if (!found) throw new McpToolError('not_found', `${kind} ${itemId} not found in this guild`)
  return found
}

export const emojisList = defineTool({
  name: 'emojis_list',
  group: 'emojis',
  tier: 'read',
  description: 'List custom emojis of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listEmojis(i.guild_id) } }),
})

export const emojisCreate = defineTool({
  name: 'emojis_create',
  group: 'emojis',
  tier: 'write',
  description: 'Create a custom emoji from a base64 data URI of at most 256 KB (write).',
  input: {
    guild_id: guildId,
    name: z.string().min(2).max(32).regex(/^\w+$/, 'letters, digits and underscore only'),
    image: imageDataUri,
    roles: z.array(snowflake).max(20).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, ...spec }) => ({
    data: await ctx.discord.createEmoji(guild_id, spec as { name: string; image: string; roles?: string[] }, auditReason(ctx)),
  }),
})

export const emojisUpdate = defineTool({
  name: 'emojis_update',
  group: 'emojis',
  tier: 'write',
  description: 'Rename a custom emoji or restrict it to roles (write).',
  input: {
    guild_id: guildId,
    emoji_id: snowflake,
    name: z.string().min(2).max(32).regex(/^\w+$/).optional(),
    roles: z.array(snowflake).max(20).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, emoji_id, ...patch }) => ({
    data: await ctx.discord.updateEmoji(guild_id, emoji_id, defined(patch), auditReason(ctx)),
  }),
})

export const emojisDelete = defineTool({
  name: 'emojis_delete',
  group: 'emojis',
  tier: 'destructive',
  description: 'Delete a custom emoji (destructive).',
  input: { guild_id: guildId, emoji_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const emoji = await findNamed(ctx, 'emoji', i.guild_id, i.emoji_id)
    return { summary: `Delete emoji ${String(emoji.name)} (${i.emoji_id})`, affected: { emojis: 1 } }
  },
  handler: async (ctx, i) => {
    await ctx.discord.deleteEmoji(i.guild_id, i.emoji_id, auditReason(ctx))
    return { data: { emoji_id: i.emoji_id } }
  },
})

export const stickersList = defineTool({
  name: 'stickers_list',
  group: 'emojis',
  tier: 'read',
  description: 'List custom stickers of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.discord.listStickers(i.guild_id) } }),
})

export const stickersCreate = defineTool({
  name: 'stickers_create',
  group: 'emojis',
  tier: 'write',
  description: 'Create a custom sticker from a base64 png, apng or json file of at most 512 KB (write).',
  input: {
    guild_id: guildId,
    name: z.string().min(2).max(30),
    description: z.string().min(2).max(100),
    tags: z.string().min(2).max(200),
    file: stickerFile,
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, ...spec }) => ({
    data: await ctx.discord.createSticker(guild_id, spec, auditReason(ctx)),
  }),
})

export const stickersDelete = defineTool({
  name: 'stickers_delete',
  group: 'emojis',
  tier: 'destructive',
  description: 'Delete a custom sticker (destructive).',
  input: { guild_id: guildId, sticker_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const sticker = await findNamed(ctx, 'sticker', i.guild_id, i.sticker_id)
    return { summary: `Delete sticker ${String(sticker.name)} (${i.sticker_id})`, affected: { stickers: 1 } }
  },
  handler: async (ctx, i) => {
    await ctx.discord.deleteSticker(i.guild_id, i.sticker_id, auditReason(ctx))
    return { data: { sticker_id: i.sticker_id } }
  },
})

export const emojisTools: AnyToolDef[] = [
  emojisList,
  emojisCreate,
  emojisUpdate,
  emojisDelete,
  stickersList,
  stickersCreate,
  stickersDelete,
]
