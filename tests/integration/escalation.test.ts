import { afterEach, describe, expect, it } from 'vitest'
import type { Principal } from '../../src/contracts/index.js'
import { buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, call, mutatingCalls, principals } from './helpers.js'

let h: Harness | undefined
afterEach(async () => {
  await h?.close()
  h = undefined
})

const MANAGE_GUILD = 1n << 5n
const MANAGE_ROLES = 1n << 28n
const MANAGE_CHANNELS = 1n << 4n
const BAN_MEMBERS = 1n << 2n
const KICK_MEMBERS = 1n << 1n
const CALLER = '600000000000000001'
const PEER = '600000000000000002'
const SUPERIOR = '600000000000000003'

const caller = (bits: bigint): Principal => ({ kind: 'user', userId: CALLER, userName: 'mallory', guilds: { [GUILD_A]: bits.toString() } })

const setup = async () => {
  const harness = await buildHarness({ config: { safety: { allow_token_confirm: true }, guilds: { [GUILD_A]: { max_tier: 'destructive' } } } })
  h = harness
  const d = harness.discord
  d.seedGuild(GUILD_A)
  const own = await d.createRole(GUILD_A, { name: 'own' })
  const below = await d.createRole(GUILD_A, { name: 'below' })
  const above = await d.createRole(GUILD_A, { name: 'above' })
  await d.updateRole(GUILD_A, below.id, { position: 2 })
  await d.updateRole(GUILD_A, own.id, { position: 5 })
  await d.updateRole(GUILD_A, above.id, { position: 9 })
  const members = d.members.get(GUILD_A)!
  members.set(CALLER, { user: { id: CALLER, username: 'mallory' }, roles: [own.id] } as never)
  members.set(PEER, { user: { id: PEER, username: 'peer' }, roles: [below.id] } as never)
  members.set(SUPERIOR, { user: { id: SUPERIOR, username: 'boss' }, roles: [above.id] } as never)
  const ch = (await d.createChannel(GUILD_A, { name: 'c', type: 0 })).id
  d.calls.length = 0
  return { harness, own, below, above, ch }
}

const denied = (code: string | null): boolean => code === 'missing_permissions' || code === 'tier_exceeded'

describe('a user principal cannot escalate beyond what they hold', () => {
  it('roles_create refuses Administrator the caller lacks and creates nothing', async () => {
    const { harness } = await setup()
    const client = await harness.asPrincipal(caller(MANAGE_GUILD | MANAGE_ROLES))
    const before = harness.discord.roles.get(GUILD_A)!.length
    const r = await call(client, 'roles_create', { guild_id: GUILD_A, name: 'backdoor', permissions: '8' })
    expect(denied(r.code), r.text).toBe(true)
    expect(harness.discord.roles.get(GUILD_A)!.length).toBe(before)
  })

  it('roles_create refuses any permission bit the caller lacks, allows held ones', async () => {
    const { harness } = await setup()
    const client = await harness.asPrincipal(caller(MANAGE_GUILD | MANAGE_ROLES))
    const bad = await call(client, 'roles_create', { guild_id: GUILD_A, name: 'x', permissions: MANAGE_CHANNELS.toString() })
    expect(denied(bad.code), bad.text).toBe(true)
    const ok = await call(client, 'roles_create', { guild_id: GUILD_A, name: 'fine', permissions: MANAGE_ROLES.toString() })
    expect(ok.isError, ok.text).toBe(false)
  })

  it('roles_update refuses to grant Administrator and to edit a role above the caller', async () => {
    const { harness, below, above } = await setup()
    const client = await harness.asPrincipal(caller(MANAGE_GUILD | MANAGE_ROLES))
    const grant = await call(client, 'roles_update', { guild_id: GUILD_A, role_id: below.id, permissions: '8' })
    expect(denied(grant.code), grant.text).toBe(true)
    const higher = await call(client, 'roles_update', { guild_id: GUILD_A, role_id: above.id, name: 'pwned' })
    expect(denied(higher.code), higher.text).toBe(true)
    expect(harness.discord.roles.get(GUILD_A)!.find((r) => r.id === above.id)!.name).toBe('above')
    const ok = await call(client, 'roles_update', { guild_id: GUILD_A, role_id: below.id, name: 'renamed' })
    expect(ok.isError, ok.text).toBe(false)
  })

  it('roles_assign and members_add_role refuse a role above the caller and a member above the caller', async () => {
    const { harness, above, below } = await setup()
    const client = await harness.asPrincipal(caller(MANAGE_GUILD | MANAGE_ROLES))
    const roleAbove = await call(client, 'roles_assign', { guild_id: GUILD_A, user_id: PEER, role_id: above.id })
    expect(denied(roleAbove.code), roleAbove.text).toBe(true)
    const viaMembers = await call(client, 'members_add_role', { guild_id: GUILD_A, user_id: PEER, role_id: above.id })
    expect(denied(viaMembers.code), viaMembers.text).toBe(true)
    const onSuperior = await call(client, 'roles_assign', { guild_id: GUILD_A, user_id: SUPERIOR, role_id: below.id })
    expect(denied(onSuperior.code), onSuperior.text).toBe(true)
    expect(harness.discord.members.get(GUILD_A)!.get(PEER)!.roles).toEqual([below.id])
    const ok = await call(client, 'roles_assign', { guild_id: GUILD_A, user_id: PEER, role_id: below.id })
    expect(ok.isError, ok.text).toBe(false)
  })

  it('channels_set_permissions refuses allow bits the caller lacks', async () => {
    const { harness, ch } = await setup()
    const client = await harness.asPrincipal(caller(MANAGE_GUILD | MANAGE_ROLES | MANAGE_CHANNELS))
    const bad = await call(client, 'channels_set_permissions', { guild_id: GUILD_A, channel_id: ch, overwrite_id: GUILD_A, type: 0, allow: BAN_MEMBERS.toString(), deny: '0' })
    expect(denied(bad.code), bad.text).toBe(true)
    expect(harness.discord.channels.get(ch)!.permission_overwrites).toBeUndefined()
  })

  it('members_update_nick refuses a member above the caller', async () => {
    const { harness } = await setup()
    const client = await harness.asPrincipal(caller(MANAGE_GUILD | MANAGE_ROLES | (1n << 27n)))
    const r = await call(client, 'members_update_nick', { guild_id: GUILD_A, user_id: SUPERIOR, nick: 'lol' })
    expect(denied(r.code), r.text).toBe(true)
    expect(harness.discord.members.get(GUILD_A)!.get(SUPERIOR)!.nick).not.toBe('lol')
  })

  it.each([
    ['mod_kick', KICK_MEMBERS, {}],
    ['mod_ban', BAN_MEMBERS, {}],
    ['mod_timeout', 1n << 40n, { duration_seconds: 60 }],
  ] as const)('%s refuses a target at or above the caller even after confirmation', async (tool, bit, extra) => {
    const { harness } = await setup()
    const client = await harness.asPrincipal(caller(MANAGE_GUILD | bit), { elicit: 'accept' })
    const r = await call(client, tool, { guild_id: GUILD_A, user_id: SUPERIOR, ...extra })
    expect(denied(r.code), r.text).toBe(true)
    const peer = await call(client, tool, { guild_id: GUILD_A, user_id: CALLER, ...extra })
    expect(denied(peer.code), peer.text).toBe(true)
    expect(mutatingCalls(harness.discord)).toEqual([])
  })

  it('mod_kick on a lower member succeeds after confirmation', async () => {
    const { harness } = await setup()
    const client = await harness.asPrincipal(caller(MANAGE_GUILD | KICK_MEMBERS), { elicit: 'accept' })
    const r = await call(client, 'mod_kick', { guild_id: GUILD_A, user_id: PEER })
    expect(r.isError, r.text).toBe(false)
    expect(harness.discord.members.get(GUILD_A)!.has(PEER)).toBe(false)
  })

  it('kick, ban and timeout each need their own permission bit', async () => {
    const { harness } = await setup()
    const banOnly = await harness.asPrincipal(caller(MANAGE_GUILD | BAN_MEMBERS), { elicit: 'accept' })
    expect((await call(banOnly, 'mod_kick', { guild_id: GUILD_A, user_id: PEER })).code).toBe('tier_exceeded')
    const kickOnly = await harness.asPrincipal(caller(MANAGE_GUILD | KICK_MEMBERS), { elicit: 'accept' })
    expect((await call(kickOnly, 'mod_ban', { guild_id: GUILD_A, user_id: PEER })).code).toBe('tier_exceeded')
    expect((await call(kickOnly, 'mod_timeout', { guild_id: GUILD_A, user_id: PEER, duration_seconds: 60 })).code).toBe('tier_exceeded')
    expect(mutatingCalls(harness.discord)).toEqual([])
  })

  it('an administrator may still create an Administrator role', async () => {
    const { harness } = await setup()
    const client = await harness.asPrincipal(principals.admin)
    const r = await call(client, 'roles_create', { guild_id: GUILD_A, name: 'admins', permissions: '8' })
    expect(r.isError, r.text).toBe(false)
  })

  it('stdio and service principals are not subject to the hierarchy', async () => {
    const { harness, above } = await setup()
    const r = await call(harness.client, 'roles_assign', { guild_id: GUILD_A, user_id: PEER, role_id: above.id })
    expect(r.isError, r.text).toBe(false)
  })
})
