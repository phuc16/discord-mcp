import { type DiscordPort, type Dto, McpToolError } from '../contracts/index.js'
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

const ISO8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

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
    if (q.before !== undefined && !ISO8601.test(q.before)) {
      throw new McpToolError('invalid_input', 'before must be an ISO8601 timestamp')
    }
    const res = await rest.get<{ threads: Dto[]; has_more?: boolean }>(`/channels/${c}/threads/archived/${q.kind}`, {
      query: { before: q.before, limit: q.limit },
    })
    return { threads: res.threads, has_more: res.has_more ?? false }
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
