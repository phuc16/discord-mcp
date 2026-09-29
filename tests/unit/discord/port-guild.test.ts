import { describe, expect, it } from 'vitest'
import { McpToolError } from '../../../src/contracts/index.js'
import { guildMethods } from '../../../src/discord/port-guild.js'
import { type Call, recordingRest } from './helpers.js'

const ALL = ((1n << 50n) - 1n).toString()
const setup = (responses: Record<string, unknown> = {}) => {
  const calls: Call[] = []
  return { calls, m: guildMethods(recordingRest(calls, responses)) }
}

describe('guild methods', () => {
  it('listBotGuildIds pages with after until fewer than 200', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({ id: String(1000 + i) }))
    let n = 0
    const { calls, m } = setup({ '/users/@me/guilds': () => (n++ === 0 ? page1 : [{ id: '5000' }]) })
    const ids = await m.listBotGuildIds()
    expect(ids).toHaveLength(201)
    expect(ids.at(-1)).toBe('5000')
    expect(calls).toEqual([
      { verb: 'get', route: '/users/@me/guilds', query: { limit: 200 } },
      { verb: 'get', route: '/users/@me/guilds', query: { limit: 200, after: '1199' } },
    ])
  })

  it('getGuild requests counts', async () => {
    const { calls, m } = setup({ '/guilds/1': { id: '1' } })
    expect(await m.getGuild('1')).toEqual({ id: '1' })
    expect(calls).toEqual([{ verb: 'get', route: '/guilds/1', query: { with_counts: 'true' } }])
  })

  it('listGuilds pages with after until a short page', async () => {
    const page1 = Array.from({ length: 200 }, (_, i) => ({ id: String(1000 + i) }))
    let n = 0
    const { calls, m } = setup({ '/users/@me/guilds': () => (n++ === 0 ? page1 : [{ id: '5000' }]) })
    expect(await m.listGuilds()).toHaveLength(201)
    expect(calls).toEqual([
      { verb: 'get', route: '/users/@me/guilds', query: { limit: 200 } },
      { verb: 'get', route: '/users/@me/guilds', query: { limit: 200, after: '1199' } },
    ])
  })

  it('updateGuild forwards reason', async () => {
    const { calls, m } = setup({ '/guilds/1': { id: '1' } })
    await m.updateGuild('1', { name: 'n' }, 'why')
    expect(calls).toEqual([{ verb: 'patch', route: '/guilds/1', body: { name: 'n' }, reason: 'why' }])
  })

  it('getGuildPreview', async () => {
    const { calls, m } = setup({ '/guilds/1/preview': { id: '1' } })
    await m.getGuildPreview('1')
    expect(calls).toEqual([{ verb: 'get', route: '/guilds/1/preview' }])
  })

  it('getPruneCount', async () => {
    const { calls, m } = setup({ '/guilds/1/prune': { pruned: 4 } })
    expect(await m.getPruneCount('1', 7)).toEqual({ pruned: 4 })
    expect(calls).toEqual([{ verb: 'get', route: '/guilds/1/prune', query: { days: 7 } }])
  })

  it('pruneGuild', async () => {
    const { calls, m } = setup({ '/guilds/1/prune': { pruned: 4 } })
    expect(await m.pruneGuild('1', 7, 'r')).toEqual({ pruned: 4 })
    expect(calls).toEqual([
      { verb: 'post', route: '/guilds/1/prune', body: { days: 7, compute_prune_count: true }, reason: 'r' },
    ])
  })

  it('widget get and update', async () => {
    const { calls, m } = setup({ '/guilds/1/widget': { enabled: true } })
    await m.getWidget('1')
    await m.updateWidget('1', { enabled: false })
    expect(calls).toEqual([
      { verb: 'get', route: '/guilds/1/widget' },
      { verb: 'patch', route: '/guilds/1/widget', body: { enabled: false } },
    ])
  })

  describe('fetchMemberPermissions', () => {
    const roles = [
      { id: '1', permissions: '1024' },
      { id: '10', permissions: '2048' },
      { id: '11', permissions: '4096' },
      { id: '12', permissions: '8' },
    ]
    const base = { '/guilds/1': { id: '1', owner_id: '99' }, '/guilds/1/roles': roles }

    it('owner gets all bits', async () => {
      const { m } = setup({ ...base, '/guilds/1/members/99': { roles: [] } })
      expect(await m.fetchMemberPermissions('1', '99')).toBe(ALL)
    })

    it('ORs everyone and member roles', async () => {
      const { calls, m } = setup({ ...base, '/guilds/1/members/5': { roles: ['10', '11'] } })
      expect(await m.fetchMemberPermissions('1', '5')).toBe(String(1024 | 2048 | 4096))
      expect(calls.map((c) => c.route)).toEqual(['/guilds/1', '/guilds/1/roles', '/guilds/1/members/5'])
    })

    it('administrator gets all bits', async () => {
      const { m } = setup({ ...base, '/guilds/1/members/5': { roles: ['12'] } })
      expect(await m.fetchMemberPermissions('1', '5')).toBe(ALL)
    })

    it('issues the three lookups concurrently', async () => {
      const issued: string[] = []
      const gate = new Promise<void>((r) => setTimeout(r, 30))
      const answers: Record<string, unknown> = { '/guilds/1': { owner_id: '99' }, '/guilds/1/roles': roles, '/guilds/1/members/5': { roles: [] } }
      const rest = recordingRest([], {})
      const slow = {
        ...rest,
        get: async (route: string) => {
          issued.push(route)
          await gate
          return answers[route]
        },
      } as typeof rest
      const pending = guildMethods(slow).fetchMemberPermissions('1', '5')
      await Promise.resolve()
      expect(issued).toEqual(['/guilds/1', '/guilds/1/roles', '/guilds/1/members/5'])
      await pending
    })

    it('missing member is not_found', async () => {
      const { m } = setup({
        ...base,
        '/guilds/1/members/5': () => {
          throw new McpToolError('not_found', 'resource not found')
        },
      })
      await expect(m.fetchMemberPermissions('1', '5')).rejects.toMatchObject({ code: 'not_found' })
    })
  })
})
