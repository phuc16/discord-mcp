import type { DiscordPort } from '../contracts/index.js'
import type { Rest } from './rest.js'

export type ModerationMethods = Pick<
  DiscordPort,
  | 'kickMember'
  | 'banMember'
  | 'unbanMember'
  | 'bulkBan'
  | 'listBans'
  | 'listAutomodRules'
  | 'createAutomodRule'
  | 'updateAutomodRule'
  | 'deleteAutomodRule'
>

export const moderationMethods = (rest: Rest): ModerationMethods => ({
  async kickMember(g, u, reason) {
    await rest.delete(`/guilds/${g}/members/${u}`, { reason })
  },
  async banMember(g, u, o, reason) {
    await rest.put(`/guilds/${g}/bans/${u}`, { body: { delete_message_seconds: o.delete_message_seconds }, reason })
  },
  async unbanMember(g, u, reason) {
    await rest.delete(`/guilds/${g}/bans/${u}`, { reason })
  },
  bulkBan: (g, userIds, o, reason) =>
    rest.post(`/guilds/${g}/bulk-ban`, {
      body: { user_ids: userIds, delete_message_seconds: o.delete_message_seconds },
      reason,
    }),
  listBans: (g, q) => rest.get(`/guilds/${g}/bans`, { query: { limit: q.limit, after: q.after } }),

  listAutomodRules: (g) => rest.get(`/guilds/${g}/auto-moderation/rules`),
  createAutomodRule: (g, spec, reason) => rest.post(`/guilds/${g}/auto-moderation/rules`, { body: spec, reason }),
  updateAutomodRule: (g, id, patch, reason) =>
    rest.patch(`/guilds/${g}/auto-moderation/rules/${id}`, { body: patch, reason }),
  async deleteAutomodRule(g, id, reason) {
    await rest.delete(`/guilds/${g}/auto-moderation/rules/${id}`, { reason })
  },
})
