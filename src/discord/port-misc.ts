import type { DiscordPort, Dto, Payload } from '../contracts/index.js'
import type { Rest } from './rest.js'

export type MiscMethods = Pick<
  DiscordPort,
  | 'listWebhooks'
  | 'createWebhook'
  | 'updateWebhook'
  | 'executeWebhook'
  | 'deleteWebhook'
  | 'listScheduledEvents'
  | 'getScheduledEvent'
  | 'createScheduledEvent'
  | 'updateScheduledEvent'
  | 'listScheduledEventUsers'
  | 'deleteScheduledEvent'
  | 'listInvites'
  | 'createInvite'
  | 'deleteInvite'
  | 'listEmojis'
  | 'createEmoji'
  | 'updateEmoji'
  | 'deleteEmoji'
  | 'listStickers'
  | 'createSticker'
  | 'deleteSticker'
  | 'listAuditLog'
>

export const miscMethods = (rest: Rest): MiscMethods => ({
  listWebhooks: (scope) =>
    rest.get('guildId' in scope ? `/guilds/${scope.guildId}/webhooks` : `/channels/${scope.channelId}/webhooks`),
  createWebhook: (c, spec, reason) => rest.post(`/channels/${c}/webhooks`, { body: spec, reason }),
  updateWebhook: (w, patch, reason) => rest.patch(`/webhooks/${w}`, { body: patch, reason }),
  executeWebhook: (w, token, body) =>
    rest.post<Dto | null>(`/webhooks/${w}/${token}`, { body, query: { wait: 'true' }, auth: false }),
  async deleteWebhook(w, reason) {
    await rest.delete(`/webhooks/${w}`, { reason })
  },

  listScheduledEvents: (g) => rest.get(`/guilds/${g}/scheduled-events`, { query: { with_user_count: 'true' } }),
  getScheduledEvent: (g, e) => rest.get(`/guilds/${g}/scheduled-events/${e}`, { query: { with_user_count: 'true' } }),
  createScheduledEvent: (g, spec, reason) => rest.post(`/guilds/${g}/scheduled-events`, { body: spec, reason }),
  updateScheduledEvent: (g, e, patch, reason) =>
    rest.patch(`/guilds/${g}/scheduled-events/${e}`, { body: patch, reason }),
  listScheduledEventUsers: (g, e, limit) =>
    rest.get<Payload[]>(`/guilds/${g}/scheduled-events/${e}/users`, { query: { limit } }),
  async deleteScheduledEvent(g, e, reason) {
    await rest.delete(`/guilds/${g}/scheduled-events/${e}`, { reason })
  },

  listInvites: (g) => rest.get<Payload[]>(`/guilds/${g}/invites`),
  createInvite: (c, spec, reason) => rest.post<Payload>(`/channels/${c}/invites`, { body: spec, reason }),
  deleteInvite: (code, reason) => rest.delete<Payload>(`/invites/${code}`, { reason }),

  listEmojis: (g) => rest.get(`/guilds/${g}/emojis`),
  createEmoji: (g, spec, reason) => rest.post(`/guilds/${g}/emojis`, { body: spec, reason }),
  updateEmoji: (g, id, patch, reason) => rest.patch(`/guilds/${g}/emojis/${id}`, { body: patch, reason }),
  async deleteEmoji(g, id, reason) {
    await rest.delete(`/guilds/${g}/emojis/${id}`, { reason })
  },

  listStickers: (g) => rest.get(`/guilds/${g}/stickers`),
  createSticker: (g, spec, reason) =>
    rest.post(`/guilds/${g}/stickers`, {
      body: { name: spec.name, description: spec.description, tags: spec.tags },
      files: [
        {
          name: spec.filename ?? 'sticker.png',
          key: 'file',
          data: Buffer.from(spec.file, 'base64'),
          contentType: spec.content_type ?? 'image/png',
        },
      ],
      reason,
    }),
  async deleteSticker(g, id, reason) {
    await rest.delete(`/guilds/${g}/stickers/${id}`, { reason })
  },

  listAuditLog: (g, q) =>
    rest.get<Payload>(`/guilds/${g}/audit-logs`, {
      query: { user_id: q.user_id, action_type: q.action_type, limit: q.limit, before: q.before },
    }),
})
