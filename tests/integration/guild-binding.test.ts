import { afterEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B, call, mutatingCalls } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async () => {
  const harness = await buildHarness({ config: { guilds: { [GUILD_A]: { max_tier: 'destructive' } } } })
  h = harness
  harness.discord.seedGuild(GUILD_A)
  harness.discord.seedGuild(GUILD_B)
  const chB = (await harness.discord.createChannel(GUILD_B, { name: 'b', type: 0 })).id
  const webhookB = await harness.discord.createWebhook(chB, { name: 'hook' })
  const inviteB = await harness.discord.createInvite(chB, {})
  const msgB = await harness.discord.sendMessage(chB, { content: 'secret' })
  harness.discord.calls.length = 0
  return { harness, chB, webhookB, inviteB, msgB }
}

const confirmed = async (harness: Harness, name: string, args: Record<string, unknown>) => {
  const first = await call(harness.client, name, args)
  if (first.code !== 'confirm_required') return first
  return call(harness.client, name, { ...args, confirm_token: first.details.confirm_token })
}

describe('guild binding', () => {
  it('messages_send with guild A and a guild B channel is not_found', async () => {
    const { harness, chB } = await setup()
    const r = await call(harness.client, 'messages_send', { guild_id: GUILD_A, channel_id: chB, content: 'hi' })
    expect(r.code).toBe('not_found')
    expect(harness.discord.calls.some((c) => c.method === 'sendMessage')).toBe(false)
    expect(mutatingCalls(harness.discord)).toEqual([])
  })

  it('channels_delete with guild A and a guild B channel is not_found even with a confirm token', async () => {
    const { harness, chB } = await setup()
    const r = await confirmed(harness, 'channels_delete', { guild_id: GUILD_A, channel_id: chB })
    expect(r.code).toBe('not_found')
    expect(harness.discord.channels.has(chB)).toBe(true)
    expect(mutatingCalls(harness.discord)).toEqual([])
  })

  it('webhooks_execute with guild A and a guild B webhook is not_found', async () => {
    const { harness, webhookB } = await setup()
    const r = await call(harness.client, 'webhooks_execute', { guild_id: GUILD_A, webhook_id: webhookB.id, content: 'x' })
    expect(r.code).toBe('not_found')
    expect(harness.discord.calls.some((c) => c.method === 'executeWebhook')).toBe(false)
  })

  it('invites_delete with guild A and a guild B invite is not_found', async () => {
    const { harness, inviteB } = await setup()
    const r = await confirmed(harness, 'invites_delete', { guild_id: GUILD_A, code: inviteB.code })
    expect(r.code).toBe('not_found')
    expect(harness.discord.invites.has(inviteB.code as string)).toBe(true)
    expect(harness.discord.calls.some((c) => c.method === 'deleteInvite')).toBe(false)
  })

  it('reads and edits scoped by channel id do not cross guilds', async () => {
    const { harness, chB, msgB, webhookB } = await setup()
    const reads = [
      ['messages_list', { guild_id: GUILD_A, channel_id: chB, limit: 10 }],
      ['messages_get', { guild_id: GUILD_A, channel_id: chB, message_id: msgB.id }],
      ['messages_list_pins', { guild_id: GUILD_A, channel_id: chB }],
      ['channels_get', { guild_id: GUILD_A, channel_id: chB }],
      ['webhooks_list', { guild_id: GUILD_A, channel_id: chB }],
      ['invites_create', { guild_id: GUILD_A, channel_id: chB }],
      ['webhooks_create', { guild_id: GUILD_A, channel_id: chB, name: 'w' }],
      ['channels_update', { guild_id: GUILD_A, channel_id: chB, name: 'renamed' }],
      ['messages_delete', { guild_id: GUILD_A, channel_id: chB, message_id: msgB.id }],
      ['webhooks_update', { guild_id: GUILD_A, webhook_id: webhookB.id, name: 'x' }],
      ['webhooks_delete', { guild_id: GUILD_A, webhook_id: webhookB.id }],
      ['messages_edit', { guild_id: GUILD_A, channel_id: chB, message_id: msgB.id, content: 'x' }],
      ['messages_pin', { guild_id: GUILD_A, channel_id: chB, message_id: msgB.id }],
      ['messages_crosspost', { guild_id: GUILD_A, channel_id: chB, message_id: msgB.id }],
      ['messages_purge', { guild_id: GUILD_A, channel_id: chB, limit: 5 }],
      ['reactions_clear', { guild_id: GUILD_A, channel_id: chB, message_id: msgB.id }],
      ['reactions_add', { guild_id: GUILD_A, channel_id: chB, message_id: msgB.id, emoji: '👍' }],
    ] as const
    const registered = new Set((await harness.client.listTools()).tools.map((t) => t.name))
    for (const [name, args] of reads) {
      expect(registered.has(name), `${name} is registered`).toBe(true)
      const r = await confirmed(harness, name, { ...args })
      expect(r.code, name).toBe('not_found')
    }
    expect(mutatingCalls(harness.discord), 'no mutation reached Discord').toEqual([])
    expect(harness.discord.channels.get(chB)!.name).toBe('b')
  })

  it('guild B resources cannot be reached through guild B directly (not allowlisted)', async () => {
    const { harness, chB } = await setup()
    const r = await call(harness.client, 'messages_send', { guild_id: GUILD_B, channel_id: chB, content: 'x' })
    expect(r.code).toBe('guild_not_allowed')
    expect(mutatingCalls(harness.discord)).toEqual([])
  })
})
