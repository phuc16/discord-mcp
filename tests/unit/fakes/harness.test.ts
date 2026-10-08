import { afterEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../../fakes/harness.js'
import type { Harness } from '../../fakes/harness.js'

const G = '100000000000000001'
let h: Harness | undefined

afterEach(async () => {
  await h?.close()
  h = undefined
})

const json = (r: unknown): Record<string, unknown> => {
  const content = (r as { content: { text: string }[] }).content
  return JSON.parse(content[0]!.text) as Record<string, unknown>
}

describe('harness', () => {
  it('lists tools and calls a read tool as stdio', async () => {
    h = await buildHarness({ config: { guilds: { [G]: { max_tier: 'destructive' } } } })
    h.discord.seedGuild(G, { channels: 2 })
    const tools = await h.client.listTools()
    expect(tools.tools.length).toBeGreaterThanOrEqual(85)
    const r = await h.client.callTool({ name: 'channels_list', arguments: { guild_id: G } })
    expect(r.isError).toBeFalsy()
  })
  it('asPrincipal binds a distinct principal', async () => {
    h = await buildHarness({ config: { guilds: { [G]: { max_tier: 'destructive' } } } })
    h.discord.seedGuild(G)
    const user = await h.asPrincipal({ kind: 'user', userId: '7', userName: 'u', guilds: {} })
    const r = await user.callTool({ name: 'channels_list', arguments: { guild_id: G } })
    expect(r.isError).toBe(true)
    expect((json(r).error as { code: string }).code).toBe('guild_not_allowed')
  })
  it('writes an audit row per call', async () => {
    h = await buildHarness({ config: { guilds: { [G]: { max_tier: 'read' } } } })
    h.discord.seedGuild(G)
    await h.client.callTool({ name: 'channels_list', arguments: { guild_id: G } })
    expect(h.store.audit.query({ limit: 10 })).toHaveLength(1)
  })
  it('clock advances confirm token expiry', async () => {
    h = await buildHarness({ config: { guilds: { [G]: { max_tier: 'destructive' } } } })
    expect(h.clock.now()).toBeGreaterThan(0)
    const before = h.clock.now()
    h.clock.advance(1000)
    expect(h.clock.now()).toBe(before + 1000)
  })
})
