import type { DiscordPort, Dto } from '../contracts/index.js'
import type { Rest } from './rest.js'

export type ChannelMethods = Pick<
  DiscordPort,
  | 'listChannels'
  | 'getChannel'
  | 'createChannel'
  | 'updateChannel'
  | 'moveChannels'
  | 'setChannelPermissions'
  | 'deleteChannelPermissions'
  | 'deleteChannel'
  | 'listActiveThreads'
  | 'listArchivedThreads'
  | 'createThread'
  | 'addThreadMember'
  | 'removeThreadMember'
  | 'createForumPost'
>

export const channelMethods = (rest: Rest): ChannelMethods => ({
  listChannels: (g) => rest.get(`/guilds/${g}/channels`),
  getChannel: (c) => rest.get(`/channels/${c}`),
  createChannel: (g, spec, reason) => rest.post(`/guilds/${g}/channels`, { body: spec, reason }),
  updateChannel: (c, patch, reason) => rest.patch(`/channels/${c}`, { body: patch, reason }),
  deleteChannel: (c, reason) => rest.delete(`/channels/${c}`, { reason }),
  async moveChannels(g, positions) {
    await rest.patch(`/guilds/${g}/channels`, { body: positions })
  },
  async setChannelPermissions(c, overwriteId, body, reason) {
    await rest.put(`/channels/${c}/permissions/${overwriteId}`, { body, reason })
  },
  async deleteChannelPermissions(c, overwriteId, reason) {
    await rest.delete(`/channels/${c}/permissions/${overwriteId}`, { reason })
  },

  async listActiveThreads(g) {
    const res = await rest.get<{ threads: Dto[] }>(`/guilds/${g}/threads/active`)
    return res.threads
  },
  async listArchivedThreads(c, q) {
    const res = await rest.get<{ threads: Dto[] }>(`/channels/${c}/threads/archived/${q.kind}`, {
      query: { before: q.before, limit: q.limit },
    })
    return res.threads
  },
  createThread(c, spec, reason) {
    const { message_id: messageId, ...body } = spec
    const route = messageId ? `/channels/${c}/messages/${messageId}/threads` : `/channels/${c}/threads`
    return rest.post(route, { body, reason })
  },
  createForumPost: (c, spec, reason) => rest.post(`/channels/${c}/threads`, { body: spec, reason }),
  async addThreadMember(t, u) {
    await rest.put(`/channels/${t}/thread-members/${u}`)
  },
  async removeThreadMember(t, u) {
    await rest.delete(`/channels/${t}/thread-members/${u}`)
  },
})
