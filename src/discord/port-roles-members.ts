import type { DiscordPort } from '../contracts/index.js'
import type { Rest } from './rest.js'

export type RoleMemberMethods = Pick<
  DiscordPort,
  | 'listRoles'
  | 'createRole'
  | 'updateRole'
  | 'reorderRoles'
  | 'deleteRole'
  | 'listMembers'
  | 'getMember'
  | 'searchMembers'
  | 'updateMember'
  | 'addMemberRole'
  | 'removeMemberRole'
>

export const roleMemberMethods = (rest: Rest): RoleMemberMethods => ({
  listRoles: (g) => rest.get(`/guilds/${g}/roles`),
  createRole: (g, spec, reason) => rest.post(`/guilds/${g}/roles`, { body: spec, reason }),
  updateRole: (g, r, patch, reason) => rest.patch(`/guilds/${g}/roles/${r}`, { body: patch, reason }),
  reorderRoles: (g, positions) => rest.patch(`/guilds/${g}/roles`, { body: positions }),
  async deleteRole(g, r, reason) {
    await rest.delete(`/guilds/${g}/roles/${r}`, { reason })
  },

  listMembers: (g, q) => rest.get(`/guilds/${g}/members`, { query: { limit: q.limit, after: q.after } }),
  getMember: (g, u) => rest.get(`/guilds/${g}/members/${u}`),
  searchMembers: (g, query, limit) => rest.get(`/guilds/${g}/members/search`, { query: { query, limit } }),
  updateMember: (g, u, patch, reason) => rest.patch(`/guilds/${g}/members/${u}`, { body: patch, reason }),
  async addMemberRole(g, u, r, reason) {
    await rest.put(`/guilds/${g}/members/${u}/roles/${r}`, { reason })
  },
  async removeMemberRole(g, u, r, reason) {
    await rest.delete(`/guilds/${g}/members/${u}/roles/${r}`, { reason })
  },
})
