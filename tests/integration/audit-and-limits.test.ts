import { afterEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B, call, principals } from './helpers.js'

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
  harness.discord.seedGuild(GUILD_A)
  harness.discord.seedGuild(GUILD_B)
  const ch = (await harness.discord.createChannel(GUILD_A, { name: 'a', type: 0 })).id
  return { harness, ch }
}

const rows = (harness: Harness) => harness.store.audit.query({ limit: 100 }).sort((a, b) => a.id - b.id)

describe('audit', () => {
  it('leaves exactly one row per call with the right outcome', async () => {
    const { harness, ch } = await setup()
    const steps: [string, Record<string, unknown>, string][] = [
      ['guild_get', { guild_id: GUILD_A }, 'ok'],
      ['channels_delete', { guild_id: GUILD_A, channel_id: ch }, 'dry_run'],
      ['channels_create', { guild_id: GUILD_B, name: 'x', type: 0 }, 'denied'],
      ['guild_get', { guild_id: '100000000000000009' }, 'denied'],
      ['channels_get', { guild_id: GUILD_A, channel_id: '999999999999999999' }, 'error'],
    ]
    for (const [i, [tool, args, outcome]] of steps.entries()) {
      await call(harness.client, tool, args)
      const all = rows(harness)
      expect(all, `after ${tool}`).toHaveLength(i + 1)
      expect(all[i]!.tool).toBe(tool)
      expect(all[i]!.outcome, tool).toBe(outcome)
    }
  })

  it('confirmed execution records ok after the dry_run row', async () => {
    const { harness, ch } = await setup()
    const first = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch })
    await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch, confirm_token: first.details.confirm_token })
    expect(rows(harness).map((r) => r.outcome)).toEqual(['dry_run', 'ok'])
  })

  it('records actor, guild and never the confirm token or raw input', async () => {
    const { harness, ch } = await setup()
    const user = await harness.asPrincipal(principals.admin)
    const first = await call(user, 'channels_delete', { guild_id: GUILD_A, channel_id: ch })
    const [row] = rows(harness)
    expect(row!.actor).toBe('admin')
    expect(row!.actorUserId).toBe('11')
    expect(row!.guildId).toBe(GUILD_A)
    expect(JSON.stringify(row)).not.toContain(first.details.confirm_token as string)
    const logged = JSON.stringify(harness.logs)
    expect(logged).not.toContain(first.details.confirm_token as string)
  })

  it('confirm_invalid is recorded as denied', async () => {
    const { harness, ch } = await setup()
    await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch, confirm_token: 'bogus' })
    expect(rows(harness).map((r) => [r.outcome, r.errorCode])).toEqual([['denied', 'confirm_invalid']])
  })

  it('audit_query returns only readable guilds for a user', async () => {
    const { harness } = await setup()
    await call(harness.client, 'guild_get', { guild_id: GUILD_A })
    await call(harness.client, 'guild_get', { guild_id: GUILD_B })
    const limited = await harness.asPrincipal({ kind: 'user', userId: '20', userName: 'only-b', guilds: { [GUILD_B]: '8' } })
    const r = await call(limited, 'audit_query', { guild_id: GUILD_B, limit: 50 })
    expect(r.isError).toBe(false)
    const denied = await call(limited, 'audit_query', { guild_id: GUILD_A, limit: 50 })
    expect(denied.code).toBe('guild_not_allowed')
  })
})

describe('bulk limits', () => {
  const bulk = (ch: string) => ({ guild_id: GUILD_A, channel_id: ch, limit: 5 })

  it('6th bulk call in a minute is rate_limited, and recovers after the window', async () => {
    const { harness, ch } = await setup()
    for (let i = 0; i < 5; i++) {
      const r = await call(harness.client, 'messages_purge', bulk(ch))
      expect(r.code, `call ${i + 1}`).toBe('confirm_required')
    }
    const sixth = await call(harness.client, 'messages_purge', bulk(ch))
    expect(sixth.code).toBe('rate_limited')
    expect(typeof sixth.details.retry_after).toBe('number')
    harness.clock.advance(61_000)
    expect((await call(harness.client, 'messages_purge', bulk(ch))).code).toBe('confirm_required')
  })

  it('the limit is per guild', async () => {
    const harness = await buildHarness({
      config: { guilds: { [GUILD_A]: { max_tier: 'destructive' }, [GUILD_B]: { max_tier: 'destructive' } } },
    })
    h = harness
    harness.discord.seedGuild(GUILD_A)
    harness.discord.seedGuild(GUILD_B)
    const chA = (await harness.discord.createChannel(GUILD_A, { name: 'a', type: 0 })).id
    const chB = (await harness.discord.createChannel(GUILD_B, { name: 'b', type: 0 })).id
    for (let i = 0; i < 5; i++) await call(harness.client, 'messages_purge', { guild_id: GUILD_A, channel_id: chA, limit: 5 })
    expect((await call(harness.client, 'messages_purge', { guild_id: GUILD_A, channel_id: chA, limit: 5 })).code).toBe('rate_limited')
    expect((await call(harness.client, 'messages_purge', { guild_id: GUILD_B, channel_id: chB, limit: 5 })).code).toBe('confirm_required')
  })

  it('caps: purge limit 1001 and 201 targets are rejected before Discord', async () => {
    const { harness, ch } = await setup()
    harness.discord.calls.length = 0
    const ids = Array.from({ length: 201 }, (_, i) => String(300000000000000000n + BigInt(i)))
    expect((await call(harness.client, 'messages_purge', { guild_id: GUILD_A, channel_id: ch, limit: 1001 })).isError).toBe(true)
    expect((await call(harness.client, 'mod_bulk_ban', { guild_id: GUILD_A, user_ids: ids })).isError).toBe(true)
    expect((await call(harness.client, 'roles_bulk_assign', { guild_id: GUILD_A, role_id: ch, user_ids: ids })).isError).toBe(true)
    expect(harness.discord.calls).toEqual([])
  })
})
