import type { DiscordPort, Dto, Payload } from '../contracts/index.js'
import type { Rest } from './rest.js'

export type GuildMethods = Pick<
  DiscordPort,
  | 'listBotGuildIds'
  | 'fetchMemberPermissions'
  | 'getGuild'
  | 'listGuilds'
  | 'updateGuild'
  | 'getGuildPreview'
  | 'getPruneCount'
  | 'pruneGuild'
  | 'getWidget'
  | 'updateWidget'
>

const ALL_PERMISSIONS = (1n << 50n) - 1n
const ADMINISTRATOR = 1n << 3n
const PAGE = 200

const listAllGuilds = async (rest: Rest): Promise<Dto[]> => {
  const out: Dto[] = []
  let after: string | undefined
  for (;;) {
    const page = await rest.get<Dto[]>('/users/@me/guilds', { query: { limit: PAGE, after } })
    out.push(...page)
    if (page.length < PAGE) return out
    after = page.at(-1)?.id
  }
}

export const guildMethods = (rest: Rest): GuildMethods => ({
  async listBotGuildIds() {
    return (await listAllGuilds(rest)).map((g) => g.id)
  },

  async fetchMemberPermissions(guildId, userId) {
    const [guild, roles, member] = await Promise.all([
      rest.get<{ owner_id: string }>(`/guilds/${guildId}`),
      rest.get<{ id: string; permissions: string }[]>(`/guilds/${guildId}/roles`),
      rest.get<{ roles: string[] }>(`/guilds/${guildId}/members/${userId}`),
    ])
    if (guild.owner_id === userId) return ALL_PERMISSIONS.toString()
    const held = new Set([guildId, ...member.roles])
    const bits = roles.filter((r) => held.has(r.id)).reduce((acc, r) => acc | BigInt(r.permissions), 0n)
    return ((bits & ADMINISTRATOR) === ADMINISTRATOR ? ALL_PERMISSIONS : bits).toString()
  },

  getGuild: (g) => rest.get(`/guilds/${g}`, { query: { with_counts: 'true' } }),
  listGuilds: () => listAllGuilds(rest),
  updateGuild: (g, patch, reason) => rest.patch(`/guilds/${g}`, { body: patch, reason }),
  getGuildPreview: (g) => rest.get(`/guilds/${g}/preview`),
  getPruneCount: (g, days) => rest.get(`/guilds/${g}/prune`, { query: { days } }),
  pruneGuild: (g, days, reason) =>
    rest.post(`/guilds/${g}/prune`, { body: { days, compute_prune_count: true }, reason }),
  getWidget: (g) => rest.get<Payload>(`/guilds/${g}/widget`),
  updateWidget: (g, patch) => rest.patch<Payload>(`/guilds/${g}/widget`, { body: patch }),
})
