import { afterEach, describe, expect, it } from 'vitest'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B, call } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const setup = async () => {
  const harness = await buildHarness({
    config: { safety: { allow_token_confirm: true }, guilds: { [GUILD_A]: { max_tier: 'destructive' }, [GUILD_B]: { max_tier: 'destructive' } } },
  })
  h = harness
  const d = harness.discord
  d.seedGuild(GUILD_A, { members: 3 })
  d.seedGuild(GUILD_B)
  const text = (await d.createChannel(GUILD_A, { name: 'text', type: 0 })).id
  const foreign = (await d.createChannel(GUILD_B, { name: 'foreign', type: 0 })).id
  d.calls.length = 0
  return { harness, d, text, foreign }
}

describe('threads', () => {
  it('threads_create defaults to a public thread', async () => {
    const { harness, text } = await setup()
    const r = await call(harness.client, 'threads_create', { guild_id: GUILD_A, channel_id: text, name: 'topic' })
    expect(r.isError, r.text).toBe(false)
    expect(r.body.type).toBe(11)
  })

  it('threads_create from a message keeps the message id as the thread id', async () => {
    const { harness, d, text } = await setup()
    const msg = await d.sendMessage(text, { content: 'hi' })
    const r = await call(harness.client, 'threads_create', { guild_id: GUILD_A, channel_id: text, name: 'from message', message_id: msg.id })
    expect(r.isError, r.text).toBe(false)
    expect(r.body.id).toBe(msg.id)
  })

  it('threads_list_archived rejects a malformed before and reports has_more', async () => {
    const { harness, text } = await setup()
    const bad = await call(harness.client, 'threads_list_archived', { guild_id: GUILD_A, channel_id: text, kind: 'public', before: 'yesterday' })
    expect(bad.isError).toBe(true)
    const ok = await call(harness.client, 'threads_list_archived', { guild_id: GUILD_A, channel_id: text, kind: 'public' })
    expect(ok.isError, ok.text).toBe(false)
    expect(ok.body.has_more).toBe(false)
  })
})

describe('forum tags round trip losslessly', () => {
  const tags = [
    { id: '900000000000000001', name: 'bug', moderated: true, emoji_id: '910000000000000001', emoji_name: null },
    { id: '900000000000000002', name: 'idea', moderated: false, emoji_id: null, emoji_name: '💡' },
  ]

  it('list then update with the same payload changes nothing', async () => {
    const { harness, d } = await setup()
    const forum = (await d.createChannel(GUILD_A, { name: 'forum', type: 15, available_tags: tags })).id
    const listed = await call(harness.client, 'forum_list_tags', { guild_id: GUILD_A, channel_id: forum })
    expect(listed.body.items).toEqual(tags)
    const updated = await call(harness.client, 'forum_update_tags', { guild_id: GUILD_A, channel_id: forum, tags: listed.body.items })
    expect(updated.isError, updated.text).toBe(false)
    expect(d.channels.get(forum)!.available_tags).toEqual(tags)
  })

  it('omitting a tag is refused unless allow_drop_tags is set', async () => {
    const { harness, d } = await setup()
    const forum = (await d.createChannel(GUILD_A, { name: 'forum', type: 15, available_tags: tags })).id
    const dropped = await call(harness.client, 'forum_update_tags', { guild_id: GUILD_A, channel_id: forum, tags: [tags[0]] })
    expect(dropped.isError).toBe(true)
    expect(d.channels.get(forum)!.available_tags).toEqual(tags)
    const allowed = await call(harness.client, 'forum_update_tags', { guild_id: GUILD_A, channel_id: forum, tags: [tags[0]], allow_drop_tags: true })
    expect(allowed.isError, allowed.text).toBe(false)
    expect(d.channels.get(forum)!.available_tags).toEqual([tags[0]])
  })

  it('channels_update cannot silently drop tags either', async () => {
    const { harness, d } = await setup()
    const forum = (await d.createChannel(GUILD_A, { name: 'forum', type: 15, available_tags: tags })).id
    const r = await call(harness.client, 'channels_update', { guild_id: GUILD_A, channel_id: forum, available_tags: [tags[0]] })
    if (!r.isError) expect(d.channels.get(forum)!.available_tags).toEqual(tags)
  })
})

describe('automod', () => {
  const base = { event_type: 1, trigger_type: 1, trigger_metadata: { keyword_filter: ['x'] }, actions: [{ type: 1 }] }

  it('trigger_type 6 needs event_type 2 and vice versa', async () => {
    const { harness } = await setup()
    const bad = await call(harness.client, 'automod_create_rule', { guild_id: GUILD_A, name: 'r', ...base, trigger_type: 6 })
    expect(bad.code).toBe('invalid_input')
    const other = await call(harness.client, 'automod_create_rule', { guild_id: GUILD_A, name: 'r', ...base, event_type: 2 })
    expect(other.code).toBe('invalid_input')
    const ok = await call(harness.client, 'automod_create_rule', { guild_id: GUILD_A, name: 'r', ...base, event_type: 2, trigger_type: 6, trigger_metadata: {} })
    expect(ok.isError, ok.text).toBe(false)
  })

  it('an alert channel of another guild is not_found and nothing is created', async () => {
    const { harness, d, foreign } = await setup()
    const r = await call(harness.client, 'automod_create_rule', {
      guild_id: GUILD_A,
      name: 'r',
      ...base,
      actions: [{ type: 2, metadata: { channel_id: foreign } }],
    })
    expect(r.code).toBe('not_found')
    expect(d.automodRules.size).toBe(0)
  })
})

describe('channels_clone', () => {
  it('copies voice limits and position', async () => {
    const { harness, d } = await setup()
    const voice = await d.createChannel(GUILD_A, { name: 'voice', type: 2, bitrate: 96000, user_limit: 7, rate_limit_per_user: 0, position: 4 })
    const r = await call(harness.client, 'channels_clone', { guild_id: GUILD_A, channel_id: voice.id, name: 'voice-2' })
    expect(r.isError, r.text).toBe(false)
    expect(r.body).toMatchObject({ bitrate: 96000, user_limit: 7, position: 4, type: 2, name: 'voice-2' })
  })

  it('copies forum tags and slowmode', async () => {
    const { harness, d } = await setup()
    const forum = await d.createChannel(GUILD_A, { name: 'forum', type: 15, rate_limit_per_user: 30, available_tags: [{ id: '1', name: 't' }] })
    const r = await call(harness.client, 'channels_clone', { guild_id: GUILD_A, channel_id: forum.id })
    expect(r.isError, r.text).toBe(false)
    expect(r.body).toMatchObject({ rate_limit_per_user: 30, available_tags: [{ id: '1', name: 't' }] })
  })
})

describe('audit log projection', () => {
  it('never returns raw webhook or integration objects', async () => {
    const { harness, d } = await setup()
    d.auditEntries.set(GUILD_A, [{ id: '1', user_id: '500000000000000005', target_id: '6', action_type: 50, reason: 'r', changes: [], options: {}, token: 'entry-secret' }])
    d.auditExtras = {
      webhooks: [{ id: '7', token: 'webhook-token-secret', url: 'https://discord.com/api/webhooks/7/webhook-token-secret' }],
      integrations: [{ id: '8', account: { id: 'acct', name: 'secret-account' } }],
      users: [{ id: '5', username: 'u', email: 'u@example.com', bot: false }],
    }
    for (const [tool, args] of [
      ['audit_log_list', {}],
      ['audit_log_by_user', { user_id: '500000000000000005' }],
      ['audit_log_by_action', { action_type: 50 }],
    ] as const) {
      const r = await call(harness.client, tool, { guild_id: GUILD_A, ...args })
      expect(r.isError, r.text).toBe(false)
      expect(r.text, tool).not.toMatch(/webhook-token-secret|entry-secret|secret-account|u@example\.com|"webhooks"|"integrations"/)
      expect(r.body.audit_log_entries).toHaveLength(1)
    }
  })
})

describe('invites and bulk operations', () => {
  it('invites_create refuses unlimited age and uses', async () => {
    const { harness, text } = await setup()
    for (const extra of [{ max_age: 0 }, { max_uses: 0 }]) {
      const r = await call(harness.client, 'invites_create', { guild_id: GUILD_A, channel_id: text, ...extra })
      expect(r.isError).toBe(true)
    }
    const ok = await call(harness.client, 'invites_create', { guild_id: GUILD_A, channel_id: text })
    expect(ok.isError, ok.text).toBe(false)
    expect(ok.body.max_age).toBe(86400)
    expect(ok.body.max_uses).toBe(10)
  })

  it('mod_bulk_ban de-duplicates ids in the preview', async () => {
    const { harness, d } = await setup()
    const [a] = [...d.members.get(GUILD_A)!.keys()]
    const r = await call(harness.client, 'mod_bulk_ban', { guild_id: GUILD_A, user_ids: [a, a, a] })
    expect(r.code).toBe('confirm_required')
    expect((r.details.preview as { affected: Record<string, number> }).affected.users).toBe(1)
  })

  it('mod_bulk_ban with nobody bannable is a clean error, not internal', async () => {
    const { harness } = await setup()
    const first = await call(harness.client, 'mod_bulk_ban', { guild_id: GUILD_A, user_ids: ['999999999999999999'] })
    const done = await call(harness.client, 'mod_bulk_ban', { guild_id: GUILD_A, user_ids: ['999999999999999999'], confirm_token: first.details.confirm_token })
    expect(done.isError).toBe(true)
    expect(done.code).not.toBe('internal')
  })

  it('roles_bulk_assign de-duplicates and audits partial failure', async () => {
    const { harness, d } = await setup()
    const role = await d.createRole(GUILD_A, { name: 'r' })
    const [a] = [...d.members.get(GUILD_A)!.keys()]
    const args = { guild_id: GUILD_A, role_id: role.id, user_ids: [a, a, '999999999999999999'] }
    const first = await call(harness.client, 'roles_bulk_assign', args)
    const done = await call(harness.client, 'roles_bulk_assign', { ...args, confirm_token: first.details.confirm_token })
    expect(done.isError, done.text).toBe(false)
    expect(d.calls.filter((c) => c.method === 'addMemberRole' && c.args[1] === a)).toHaveLength(1)
    const rows = harness.store.audit.query({ tool: 'roles_bulk_assign', limit: 10 })
    expect(rows.map((r) => r.outcome)).not.toContain('ok')
  })
})
