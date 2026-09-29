import { describe, expect, it } from 'vitest'
import { FakeDiscordPort } from '../../fakes/fake-discord-port.js'
import { FakeGateway } from '../../fakes/fake-gateway.js'
import { startMockDiscord } from '../../fakes/mock-discord-server.js'
import { McpToolError } from '../../../src/contracts/index.js'

const G1 = '100000000000000001'
const G2 = '100000000000000002'

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(McpToolError)
  expect((err as McpToolError).code).toBe(code)
}

describe('FakeDiscordPort guild and channels', () => {
  it('seeds guilds with channels, roles and members', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1, { channels: 3, roles: 2, members: 4 })
    expect(await d.listBotGuildIds()).toEqual([G1])
    expect((await d.listChannels(G1)).length).toBe(3)
    expect((await d.listRoles(G1)).length).toBeGreaterThanOrEqual(2)
    expect((await d.listMembers(G1, { limit: 100 })).length).toBe(4)
  })
  it('create then list; delete then get is not_found', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1)
    const c = await d.createChannel(G1, { name: 'x', type: 0 })
    expect(c.id).toMatch(/^\d{18}$/)
    expect((await d.listChannels(G1)).some((x) => x.id === c.id)).toBe(true)
    await d.deleteChannel(c.id)
    await rejectsWith(d.getChannel(c.id), 'not_found')
  })
  it('cross-guild channel lookup returns the owning guild id', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1)
    d.seedGuild(G2)
    const c = await d.createChannel(G2, { name: 'b', type: 0 })
    expect((await d.getChannel(c.id)).guild_id).toBe(G2)
  })
  it('unknown guild is not_found', async () => {
    await rejectsWith(new FakeDiscordPort().getGuild(G1), 'not_found')
  })
  it('records calls', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1)
    await d.getGuild(G1)
    expect(d.calls.at(-1)).toEqual({ method: 'getGuild', args: [G1] })
  })
})

describe('FakeDiscordPort roles, members, moderation', () => {
  it('adds and removes member roles', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1, { roles: 1, members: 1 })
    const role = await d.createRole(G1, { name: 'r' })
    const [m] = await d.listMembers(G1, { limit: 1 })
    await d.addMemberRole(G1, m!.id, role.id)
    expect((await d.getMember(G1, m!.id)).roles).toContain(role.id)
    await d.removeMemberRole(G1, m!.id, role.id)
    expect((await d.getMember(G1, m!.id)).roles).not.toContain(role.id)
  })
  it('deleting a role strips it from members', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1, { members: 1 })
    const role = await d.createRole(G1, { name: 'r' })
    const [m] = await d.listMembers(G1, { limit: 1 })
    await d.addMemberRole(G1, m!.id, role.id)
    await d.deleteRole(G1, role.id)
    expect((await d.getMember(G1, m!.id)).roles).not.toContain(role.id)
  })
  it('ban then list, unban removes', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1, { members: 2 })
    const [m] = await d.listMembers(G1, { limit: 1 })
    await d.banMember(G1, m!.id, {})
    expect((await d.listBans(G1, { limit: 10 })).length).toBe(1)
    await rejectsWith(d.getMember(G1, m!.id), 'not_found')
    await d.unbanMember(G1, m!.id)
    expect((await d.listBans(G1, { limit: 10 })).length).toBe(0)
    await rejectsWith(d.unbanMember(G1, m!.id), 'not_found')
  })
  it('kick removes member', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1, { members: 1 })
    const [m] = await d.listMembers(G1, { limit: 1 })
    await d.kickMember(G1, m!.id)
    await rejectsWith(d.getMember(G1, m!.id), 'not_found')
  })
  it('bulk ban reports failed users for non-members', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1, { members: 1 })
    const [m] = await d.listMembers(G1, { limit: 1 })
    const r = await d.bulkBan(G1, [m!.id, '999999999999999999'], {})
    expect(r.banned_users).toEqual([m!.id])
    expect(r.failed_users).toEqual(['999999999999999999'])
  })
})

describe('FakeDiscordPort messages and misc', () => {
  const setup = async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1)
    const ch = await d.createChannel(G1, { name: 'c', type: 0 })
    return { d, ch }
  }
  it('send, get, edit, delete', async () => {
    const { d, ch } = await setup()
    const m = await d.sendMessage(ch.id, { content: 'hi' })
    expect((await d.getMessage(ch.id, m.id)).content).toBe('hi')
    await d.editMessage(ch.id, m.id, { content: 'yo' })
    expect((await d.getMessage(ch.id, m.id)).content).toBe('yo')
    await d.deleteMessage(ch.id, m.id)
    await rejectsWith(d.getMessage(ch.id, m.id), 'not_found')
  })
  it('bulk delete removes messages', async () => {
    const { d, ch } = await setup()
    const a = await d.sendMessage(ch.id, { content: 'a' })
    const b = await d.sendMessage(ch.id, { content: 'b' })
    const c = await d.sendMessage(ch.id, { content: 'c' })
    await d.bulkDeleteMessages(ch.id, [a.id, b.id])
    expect((await d.listMessages(ch.id, { limit: 10 })).map((x) => x.id)).toEqual([c.id])
  })
  it('sending to unknown channel is not_found and records no message', async () => {
    const { d } = await setup()
    await rejectsWith(d.sendMessage('999999999999999999', { content: 'x' }), 'not_found')
  })
  it('pins, reactions', async () => {
    const { d, ch } = await setup()
    const m = await d.sendMessage(ch.id, { content: 'a' })
    await d.pinMessage(ch.id, m.id)
    expect((await d.listPins(ch.id)).map((x) => x.id)).toEqual([m.id])
    await d.unpinMessage(ch.id, m.id)
    expect(await d.listPins(ch.id)).toEqual([])
    await d.addReaction(ch.id, m.id, '👍')
    await d.clearReactions(ch.id, m.id)
  })
  it('webhooks carry channel and guild ids', async () => {
    const { d, ch } = await setup()
    const w = await d.createWebhook(ch.id, { name: 'w' })
    expect(w.channel_id).toBe(ch.id)
    expect(w.guild_id).toBe(G1)
    expect((await d.listWebhooks({ guildId: G1 })).map((x) => x.id)).toContain(w.id)
    expect((await d.listWebhooks({ channelId: ch.id })).map((x) => x.id)).toContain(w.id)
    await d.deleteWebhook(w.id)
    expect(await d.listWebhooks({ guildId: G1 })).toEqual([])
  })
  it('invites carry guild id and delete by code', async () => {
    const { d, ch } = await setup()
    const inv = await d.createInvite(ch.id, {})
    expect(typeof inv.code).toBe('string')
    expect((inv.guild as { id: string }).id).toBe(G1)
    expect((await d.listInvites(G1)).length).toBe(1)
    await d.deleteInvite(inv.code as string)
    await rejectsWith(d.deleteInvite(inv.code as string), 'not_found')
  })
  it('scheduled events, emojis, automod, threads create/list/delete', async () => {
    const { d, ch } = await setup()
    const ev = await d.createScheduledEvent(G1, { name: 'e' })
    expect((await d.getScheduledEvent(G1, ev.id)).name).toBe('e')
    await d.deleteScheduledEvent(G1, ev.id)
    await rejectsWith(d.getScheduledEvent(G1, ev.id), 'not_found')
    const em = await d.createEmoji(G1, { name: 'e', image: 'data:image/png;base64,AA==' })
    expect((await d.listEmojis(G1)).map((x) => x.id)).toEqual([em.id])
    await d.deleteEmoji(G1, em.id)
    const rule = await d.createAutomodRule(G1, { name: 'r' })
    await d.deleteAutomodRule(G1, rule.id)
    await rejectsWith(d.deleteAutomodRule(G1, rule.id), 'not_found')
    const t = await d.createThread(ch.id, { name: 't' })
    expect(t.guild_id).toBe(G1)
    expect((await d.listActiveThreads(G1)).map((x) => x.id)).toContain(t.id)
  })
  it('audit log returns an entries payload', async () => {
    const { d } = await setup()
    const log = await d.listAuditLog(G1, {})
    expect(Array.isArray(log.audit_log_entries)).toBe(true)
  })
})

describe('FakeDiscordPort permissions', () => {
  it('returns configured member permissions', async () => {
    const d = new FakeDiscordPort()
    d.seedGuild(G1)
    d.memberPermissions.set(`${G1}:42`, '8')
    expect(await d.fetchMemberPermissions(G1, '42')).toBe('8')
    await rejectsWith(d.fetchMemberPermissions(G1, '43'), 'not_found')
  })
})

describe('FakeGateway', () => {
  it('emits events to subscribers and unsubscribes', () => {
    const g = new FakeGateway()
    const seen: string[] = []
    const off = g.onEvent((e) => seen.push(e.type))
    g.emit({ guildId: G1, type: 'member_join', at: 'now', data: {} })
    off()
    g.emit({ guildId: G1, type: 'member_join', at: 'now', data: {} })
    expect(seen).toEqual(['member_join'])
  })
  it('tracks status and notifies', () => {
    const g = new FakeGateway()
    const seen: string[] = []
    g.onStatus((s) => seen.push(s))
    g.setStatus('ready')
    expect(g.status()).toBe('ready')
    expect(seen).toEqual(['ready'])
  })
})

describe('mock Discord server', () => {
  it('rejects unknown codes and serves configured users', async () => {
    const srv = await startMockDiscord({
      users: { good: { id: '5', username: 'ann', guilds: [{ id: G1, permissions: '8' }] } },
    })
    try {
      const bad = await fetch(`${srv.url}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: 'nope', redirect_uri: 'http://x' }),
      })
      expect(bad.status).toBe(400)
      const ok = await fetch(`${srv.url}/oauth2/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code: 'good', redirect_uri: 'http://x' }),
      })
      expect(ok.status).toBe(200)
      const { access_token } = (await ok.json()) as { access_token: string }
      const auth = { authorization: `Bearer ${access_token}` }
      expect(await (await fetch(`${srv.url}/users/@me`, { headers: auth })).json()).toMatchObject({ id: '5', username: 'ann' })
      expect(await (await fetch(`${srv.url}/users/@me/guilds`, { headers: auth })).json()).toEqual([{ id: G1, permissions: '8' }])
      expect((await fetch(`${srv.url}/users/@me`, { headers: { authorization: 'Bearer bogus' } })).status).toBe(401)
    } finally {
      await srv.close()
    }
  })
})
