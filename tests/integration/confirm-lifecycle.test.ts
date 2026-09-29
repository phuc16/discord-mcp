import { afterEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, call, principals } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async () => {
  const harness = await buildHarness({ config: { guilds: { [GUILD_A]: { max_tier: 'destructive' } } } })
  h = harness
  harness.discord.seedGuild(GUILD_A)
  const ch1 = (await harness.discord.createChannel(GUILD_A, { name: 'one', type: 0 })).id
  const ch2 = (await harness.discord.createChannel(GUILD_A, { name: 'two', type: 0 })).id
  harness.discord.calls.length = 0
  return { harness, ch1, ch2 }
}

const deletes = (h: Harness): number => h.discord.calls.filter((c) => c.method === 'deleteChannel').length

describe('confirm lifecycle', () => {
  it('first call returns confirm_required with preview and token, Discord untouched', async () => {
    const { harness, ch1 } = await setup()
    const r = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    expect(r.isError).toBe(true)
    expect(r.code).toBe('confirm_required')
    expect(typeof r.details.confirm_token).toBe('string')
    expect((r.details.preview as { summary: string }).summary).toContain('one')
    expect(deletes(harness)).toBe(0)
    expect(harness.discord.channels.has(ch1)).toBe(true)
  })

  it('re-call with token executes exactly once and replay is confirm_invalid', async () => {
    const { harness, ch1 } = await setup()
    const first = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    const token = first.details.confirm_token as string
    const args = { guild_id: GUILD_A, channel_id: ch1, confirm_token: token }
    const ok = await call(harness.client, 'channels_delete', args)
    expect(ok.isError).toBe(false)
    expect(deletes(harness)).toBe(1)
    expect(harness.discord.channels.has(ch1)).toBe(false)
    const replay = await call(harness.client, 'channels_delete', args)
    expect(replay.code).toBe('confirm_invalid')
    expect(deletes(harness)).toBe(1)
  })

  it('token with changed input is confirm_invalid and does not execute', async () => {
    const { harness, ch1, ch2 } = await setup()
    const first = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    const r = await call(harness.client, 'channels_delete', {
      guild_id: GUILD_A,
      channel_id: ch2,
      confirm_token: first.details.confirm_token,
    })
    expect(r.code).toBe('confirm_invalid')
    expect(deletes(harness)).toBe(0)
    expect(harness.discord.channels.has(ch2)).toBe(true)
  })

  it('token issued for one destructive tool cannot run another', async () => {
    const { harness, ch1 } = await setup()
    const first = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    const r = await call(harness.client, 'threads_delete', {
      guild_id: GUILD_A,
      thread_id: ch1,
      confirm_token: first.details.confirm_token,
    })
    expect(r.code).toBe('confirm_invalid')
    expect(deletes(harness)).toBe(0)
  })

  it('token from another principal is confirm_invalid', async () => {
    const { harness, ch1 } = await setup()
    const first = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    const service = await harness.asPrincipal(principals.service)
    const r = await call(service, 'channels_delete', {
      guild_id: GUILD_A,
      channel_id: ch1,
      confirm_token: first.details.confirm_token,
    })
    expect(r.code).toBe('confirm_invalid')
    expect(deletes(harness)).toBe(0)
  })

  it('expired token is confirm_invalid', async () => {
    const { harness, ch1 } = await setup()
    const first = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    harness.clock.advance(5 * 60_000 + 1000)
    const r = await call(harness.client, 'channels_delete', {
      guild_id: GUILD_A,
      channel_id: ch1,
      confirm_token: first.details.confirm_token,
    })
    expect(r.code).toBe('confirm_invalid')
    expect(deletes(harness)).toBe(0)
  })

  it('token just inside the TTL still works', async () => {
    const { harness, ch1 } = await setup()
    const first = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    harness.clock.advance(5 * 60_000 - 1000)
    const r = await call(harness.client, 'channels_delete', {
      guild_id: GUILD_A,
      channel_id: ch1,
      confirm_token: first.details.confirm_token,
    })
    expect(r.isError).toBe(false)
  })

  it('garbage token is confirm_invalid', async () => {
    const { harness, ch1 } = await setup()
    const r = await call(harness.client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1, confirm_token: 'nope' })
    expect(r.code).toBe('confirm_invalid')
    expect(deletes(harness)).toBe(0)
  })

  it('non-destructive tools ignore no token and never demand one', async () => {
    const { harness } = await setup()
    const r = await call(harness.client, 'channels_create', { guild_id: GUILD_A, name: 'x', type: 0 })
    expect(r.isError).toBe(false)
  })
})

describe('in-band elicitation', () => {
  it('accept executes without a token and audits a single ok row', async () => {
    const { harness, ch1 } = await setup()
    const asked: string[] = []
    const client = await harness.asPrincipal(principals.stdio, { elicit: 'accept', onElicit: (m) => asked.push(m) })
    const r = await call(client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    expect(r.isError).toBe(false)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('one')
    expect(harness.discord.channels.has(ch1)).toBe(false)
    expect(harness.store.audit.query({ limit: 10 }).map((a) => a.outcome)).toEqual(['ok'])
  })

  it('decline does not execute and is audited as denied', async () => {
    const { harness, ch1 } = await setup()
    const client = await harness.asPrincipal(principals.stdio, { elicit: 'decline' })
    const r = await call(client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch1 })
    expect(r.code).toBe('confirm_invalid')
    expect(harness.discord.channels.has(ch1)).toBe(true)
    expect(deletes(harness)).toBe(0)
    expect(harness.store.audit.query({ limit: 10 }).map((a) => [a.outcome, a.errorCode])).toEqual([['denied', 'confirm_invalid']])
  })

  it('elicitation never bypasses tier checks', async () => {
    const harness = await buildHarness({ config: { guilds: { [GUILD_A]: { max_tier: 'write' } } } })
    h = harness
    harness.discord.seedGuild(GUILD_A)
    const ch = (await harness.discord.createChannel(GUILD_A, { name: 'x', type: 0 })).id
    const asked: string[] = []
    const client = await harness.asPrincipal(principals.stdio, { elicit: 'accept', onElicit: (m) => asked.push(m) })
    const r = await call(client, 'channels_delete', { guild_id: GUILD_A, channel_id: ch })
    expect(r.code).toBe('tier_exceeded')
    expect(asked).toEqual([])
    expect(harness.discord.channels.has(ch)).toBe(true)
  })
})
