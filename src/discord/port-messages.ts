import { Routes } from 'discord.js'
import type { DiscordPort } from '../contracts/index.js'
import type { Rest } from './rest.js'

export type MessageMethods = Pick<
  DiscordPort,
  | 'listMessages'
  | 'getMessage'
  | 'sendMessage'
  | 'editMessage'
  | 'deleteMessage'
  | 'bulkDeleteMessages'
  | 'pinMessage'
  | 'unpinMessage'
  | 'listPins'
  | 'crosspostMessage'
  | 'addReaction'
  | 'removeReaction'
  | 'clearReactions'
>

const DISCORD_EPOCH = 1420070400000n
const BULK_MAX_AGE_MS = 14 * 86_400_000 - 3_600_000
const BULK_BATCH = 100

const createdAt = (snowflake: string): number => Number((BigInt(snowflake) >> 22n) + DISCORD_EPOCH)

const chunk = <T>(items: T[], size: number): T[][] =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) => items.slice(i * size, (i + 1) * size))

export const messageMethods = (rest: Rest): MessageMethods => {
  const deleteOne = async (channelId: string, messageId: string, reason?: string) => {
    await rest.delete(`/channels/${channelId}/messages/${messageId}`, { reason })
  }

  return {
    listMessages: (c, q) => rest.get(`/channels/${c}/messages`, { query: { limit: q.limit, before: q.before, after: q.after } }),
    getMessage: (c, m) => rest.get(`/channels/${c}/messages/${m}`),
    sendMessage: (c, body) => rest.post(`/channels/${c}/messages`, { body }),
    editMessage: (c, m, body) => rest.patch(`/channels/${c}/messages/${m}`, { body }),
    deleteMessage: deleteOne,

    async bulkDeleteMessages(c, ids, reason) {
      const cutoff = Date.now() - BULK_MAX_AGE_MS
      const fresh = ids.filter((id) => createdAt(id) >= cutoff)
      const stale = ids.filter((id) => createdAt(id) < cutoff)
      for (const batch of chunk(fresh, BULK_BATCH)) {
        if (batch.length === 1) await deleteOne(c, batch[0] as string, reason)
        else await rest.post(`/channels/${c}/messages/bulk-delete`, { body: { messages: batch }, reason })
      }
      for (const id of stale) await deleteOne(c, id, reason)
    },

    async pinMessage(c, m, reason) {
      await rest.put(Routes.channelPin(c, m), { reason })
    },
    async unpinMessage(c, m, reason) {
      await rest.delete(Routes.channelPin(c, m), { reason })
    },
    listPins: (c) => rest.get(Routes.channelPins(c)),
    crosspostMessage: (c, m) => rest.post(`/channels/${c}/messages/${m}/crosspost`),

    async addReaction(c, m, emoji) {
      await rest.put(`/channels/${c}/messages/${m}/reactions/${encodeURIComponent(emoji)}/@me`)
    },
    async removeReaction(c, m, emoji, userId) {
      await rest.delete(`/channels/${c}/messages/${m}/reactions/${encodeURIComponent(emoji)}/${userId ?? '@me'}`)
    },
    async clearReactions(c, m) {
      await rest.delete(`/channels/${c}/messages/${m}/reactions`)
    },
  }
}
