import { afterEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B, GUILD_C, call, principals } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async () => {
  const harness = await buildHarness({
    config: { guilds: { [GUILD_A]: { max_tier: 'destructive' }, [GUILD_B]: { max_tier: 'read' } } },
  })
  h = harness
  for (const g of [GUILD_A, GUILD_B, GUILD_C]) harness.discord.seedGuild(g)
  return harness
}

const ids = (r: { body: Record<string, unknown> }): string[] => ((r.body.items ?? []) as { id: string }[]).map((g) => g.id).sort()

describe('unscoped tools do not leak other guilds', () => {
  it('guild_list hides non-allowlisted guilds from stdio and service principals', async () => {
    const harness = await setup()
    expect(ids(await call(harness.client, 'guild_list', {}))).toEqual([GUILD_A, GUILD_B])
    const service = await harness.asPrincipal(principals.service)
    expect(ids(await call(service, 'guild_list', {}))).toEqual([GUILD_A, GUILD_B])
  })

  it('guild_list shows a user only guilds they can access', async () => {
    const harness = await setup()
    const user = await harness.asPrincipal({ kind: 'user', userId: '1', userName: 'u', guilds: { [GUILD_B]: '8', [GUILD_C]: '8' } })
    expect(ids(await call(user, 'guild_list', {}))).toEqual([GUILD_B])
    const nobody = await harness.asPrincipal(principals.notInGuild)
    expect(ids(await call(nobody, 'guild_list', {}))).toEqual([])
  })

  it('server_policy lists only accessible guilds with capped effective tiers', async () => {
    const harness = await setup()
    const user = await harness.asPrincipal({ kind: 'user', userId: '1', userName: 'u', guilds: { [GUILD_B]: '8', [GUILD_C]: '8' } })
    const r = await call(user, 'server_policy', {})
    expect(Object.keys(r.body.guilds as object)).toEqual([GUILD_B])
    expect((r.body.guilds as Record<string, { effectiveTier: string }>)[GUILD_B]!.effectiveTier).toBe('read')
  })

  it('server_whoami reports the calling principal', async () => {
    const harness = await setup()
    const r = await call(harness.client, 'server_whoami', {})
    expect(r.body).toMatchObject({ kind: 'stdio', user_name: 'stdio' })
  })
})
