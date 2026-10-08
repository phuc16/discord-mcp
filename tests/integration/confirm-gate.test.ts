import { afterEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, call, mutatingCalls, principals } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async (allowToken = false) => {
  const harness = await buildHarness({
    config: { safety: { allow_token_confirm: allowToken }, guilds: { [GUILD_A]: { max_tier: 'destructive' } } },
  })
  h = harness
  harness.discord.seedGuild(GUILD_A)
  const ch = (await harness.discord.createChannel(GUILD_A, { name: 'victim', type: 0 })).id
  harness.discord.calls.length = 0
  return { harness, ch }
}

const args = (ch: string) => ({ guild_id: GUILD_A, channel_id: ch })

describe('destructive calls fail closed by default', () => {
  it('without elicitation support: confirm_required, no token, nothing mutated', async () => {
    const { harness, ch } = await setup()
    const r = await call(harness.client, 'channels_delete', args(ch))
    expect(r.code).toBe('confirm_required')
    expect(r.details).not.toHaveProperty('confirm_token')
    expect(r.text).not.toMatch(/confirm_token/)
    expect(mutatingCalls(harness.discord)).toEqual([])
    expect(harness.discord.channels.has(ch)).toBe(true)
  })

  it('a client-supplied confirm_token is never honoured when token flow is off', async () => {
    const { harness, ch } = await setup()
    for (const token of ['bogus', 'x'.repeat(43)]) {
      const r = await call(harness.client, 'channels_delete', { ...args(ch), confirm_token: token })
      expect(r.isError).toBe(true)
      expect(harness.discord.channels.has(ch)).toBe(true)
    }
    expect(mutatingCalls(harness.discord)).toEqual([])
  })

  it('elicitation that throws fails closed with no token', async () => {
    const { harness, ch } = await setup()
    const client = await harness.asPrincipal(principals.stdio, { elicit: 'error' })
    const r = await call(client, 'channels_delete', args(ch))
    expect(r.code).toBe('confirm_required')
    expect(r.details).not.toHaveProperty('confirm_token')
    expect(mutatingCalls(harness.discord)).toEqual([])
  })

  it('decline is denied outright and issues no token', async () => {
    const { harness, ch } = await setup()
    const client = await harness.asPrincipal(principals.stdio, { elicit: 'decline' })
    const r = await call(client, 'channels_delete', args(ch))
    expect(r.code).toBe('confirm_invalid')
    expect(r.details).not.toHaveProperty('confirm_token')
    expect(harness.discord.channels.has(ch)).toBe(true)
  })

  it('accepted elicitation executes for every principal kind', async () => {
    for (const p of [principals.stdio, principals.service, principals.admin]) {
      const { harness, ch } = await setup()
      const asked: string[] = []
      const client = await harness.asPrincipal(p, { elicit: 'accept', onElicit: (m) => asked.push(m) })
      const r = await call(client, 'channels_delete', args(ch))
      expect(r.isError, p.kind).toBe(false)
      expect(asked, p.kind).toHaveLength(1)
      expect(harness.discord.channels.has(ch), p.kind).toBe(false)
      await h?.close()
    }
  })

  it('untrusted text is sanitised before it reaches the elicitation prompt', async () => {
    const { harness } = await setup()
    const evil = await harness.discord.createChannel(GUILD_A, { name: '@everyone `x` [click](http://evil) ‮\u0007 <@1>', type: 0 })
    const asked: string[] = []
    const client = await harness.asPrincipal(principals.stdio, { elicit: 'decline', onElicit: (m) => asked.push(m) })
    await call(client, 'channels_delete', args(evil.id))
    expect(asked).toHaveLength(1)
    expect(asked[0]).not.toMatch(/[\u0000-\u001f\u007f‮]/)
    expect(asked[0]).not.toMatch(/[`\[\]<>]|@everyone/)
  })
})

describe('token flow only when explicitly enabled', () => {
  it('issues a token, executes once, replay is invalid', async () => {
    const { harness, ch } = await setup(true)
    const first = await call(harness.client, 'channels_delete', args(ch))
    expect(first.code).toBe('confirm_required')
    const token = first.details.confirm_token as string
    expect(typeof token).toBe('string')
    const done = await call(harness.client, 'channels_delete', { ...args(ch), confirm_token: token })
    expect(done.isError).toBe(false)
    expect(harness.discord.channels.has(ch)).toBe(false)
    expect((await call(harness.client, 'channels_delete', { ...args(ch), confirm_token: token })).code).toBe('confirm_invalid')
  })

  it('a declined elicitation falls back to a token', async () => {
    const { harness, ch } = await setup(true)
    const client = await harness.asPrincipal(principals.stdio, { elicit: 'decline' })
    const r = await call(client, 'channels_delete', args(ch))
    expect(r.code).toBe('confirm_required')
    expect(typeof r.details.confirm_token).toBe('string')
    expect(harness.discord.channels.has(ch)).toBe(true)
  })
})
