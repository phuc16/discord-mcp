import { afterEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B, GUILD_C, call, mutatingCalls, principals } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async () => {
  const harness = await buildHarness({
    config: { guilds: { [GUILD_A]: { max_tier: 'destructive' }, [GUILD_B]: { max_tier: 'write' } } },
  })
  h = harness
  harness.discord.seedGuild(GUILD_A)
  harness.discord.seedGuild(GUILD_B)
  harness.discord.seedGuild(GUILD_C)
  const channels = {
    [GUILD_A]: (await harness.discord.createChannel(GUILD_A, { name: 'a', type: 0 })).id,
    [GUILD_B]: (await harness.discord.createChannel(GUILD_B, { name: 'b', type: 0 })).id,
    [GUILD_C]: (await harness.discord.createChannel(GUILD_C, { name: 'c', type: 0 })).id,
  }
  harness.discord.calls.length = 0
  return { harness, channels }
}

const ALLOWED = 'allowed'
type Expect = typeof ALLOWED | 'guild_not_allowed' | 'tier_exceeded'

type Row = [principal: keyof typeof principals, guild: string, expected: Expect]

const readRows: Row[] = [
  ['stdio', GUILD_A, ALLOWED],
  ['stdio', GUILD_B, ALLOWED],
  ['stdio', GUILD_C, 'guild_not_allowed'],
  ['service', GUILD_A, ALLOWED],
  ['service', GUILD_C, 'guild_not_allowed'],
  ['admin', GUILD_A, ALLOWED],
  ['admin', GUILD_B, ALLOWED],
  ['admin', GUILD_C, 'guild_not_allowed'],
  ['manageGuildOnly', GUILD_A, ALLOWED],
  ['banAndManageGuild', GUILD_B, ALLOWED],
  ['notInGuild', GUILD_A, 'guild_not_allowed'],
  ['notInGuild', GUILD_B, 'guild_not_allowed'],
]

const writeRows: Row[] = [
  ['stdio', GUILD_A, ALLOWED],
  ['stdio', GUILD_B, ALLOWED],
  ['stdio', GUILD_C, 'guild_not_allowed'],
  ['service', GUILD_A, ALLOWED],
  ['service', GUILD_B, ALLOWED],
  ['admin', GUILD_A, ALLOWED],
  ['admin', GUILD_B, ALLOWED],
  ['admin', GUILD_C, 'guild_not_allowed'],
  ['manageGuildOnly', GUILD_A, ALLOWED],
  ['manageGuildOnly', GUILD_B, ALLOWED],
  ['banAndManageGuild', GUILD_A, ALLOWED],
  ['notInGuild', GUILD_A, 'guild_not_allowed'],
]

const destructiveRows: Row[] = [
  ['stdio', GUILD_A, ALLOWED],
  ['stdio', GUILD_B, 'tier_exceeded'],
  ['stdio', GUILD_C, 'guild_not_allowed'],
  ['service', GUILD_A, ALLOWED],
  ['service', GUILD_B, 'tier_exceeded'],
  ['admin', GUILD_A, ALLOWED],
  ['admin', GUILD_B, 'tier_exceeded'],
  ['admin', GUILD_C, 'guild_not_allowed'],
  ['manageGuildOnly', GUILD_A, 'tier_exceeded'],
  ['manageGuildOnly', GUILD_B, 'tier_exceeded'],
  ['banAndManageGuild', GUILD_A, 'tier_exceeded'],
  ['notInGuild', GUILD_A, 'guild_not_allowed'],
]

describe('policy matrix', () => {
  describe.each([
    ['read tool guild_get', 'guild_get', readRows],
    ['write tool channels_create', 'channels_create', writeRows],
    ['destructive tool channels_delete', 'channels_delete', destructiveRows],
  ] as const)('%s', (_label, tool, rows) => {
    it.each(rows)('%s on guild %s -> %s', async (who, guild, expected) => {
      const { harness, channels } = await setup()
      const client = await harness.asPrincipal(principals[who])
      const args: Record<string, unknown> =
        tool === 'guild_get'
          ? { guild_id: guild }
          : tool === 'channels_create'
            ? { guild_id: guild, name: 'new', type: 0 }
            : { guild_id: guild, channel_id: channels[guild as keyof typeof channels] }
      const r = await call(client, tool, args)
      if (expected === ALLOWED) {
        if (tool === 'channels_delete') expect(r.code).toBe('confirm_required')
        else expect(r.isError).toBe(false)
      } else {
        expect(r.isError).toBe(true)
        expect(r.code).toBe(expected)
        expect(mutatingCalls(harness.discord)).toEqual([])
      }
      if (tool === 'channels_delete') expect(mutatingCalls(harness.discord)).toEqual([])
    })
  })

  it('moderation group needs moderation permissions for destructive kick', async () => {
    const { harness } = await setup()
    const member = '500000000000000001'
    harness.discord.members.get(GUILD_A)!.set(member, { id: member, user: { id: member, username: 'x' }, roles: [] })
    const bm = await harness.asPrincipal(principals.banAndManageGuild)
    const mg = await harness.asPrincipal(principals.manageGuildOnly)
    expect((await call(bm, 'mod_kick', { guild_id: GUILD_A, user_id: member })).code).toBe('confirm_required')
    expect((await call(mg, 'mod_kick', { guild_id: GUILD_A, user_id: member })).code).toBe('tier_exceeded')
    expect(mutatingCalls(harness.discord)).toEqual([])
  })

  it('denied tools are not registered', async () => {
    const harness = await buildHarness({ config: { tools: { deny: ['guild_prune'] } } })
    h = harness
    const names = (await harness.client.listTools()).tools.map((t) => t.name)
    expect(names).not.toContain('guild_prune')
    expect(names).toContain('guild_get')
  })
})
