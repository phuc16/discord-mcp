import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPermissionRefresher } from '../../../src/auth/refresh.js'
import { McpToolError } from '../../../src/contracts/index.js'
import type { NormalizedEvent } from '../../../src/contracts/index.js'
import { PERM } from '../../../src/safety/index.js'
import { openStore } from '../../../src/store/index.js'
import type { Store } from '../../../src/store/index.js'

const G1 = '111111111111111111'
const G2 = '222222222222222222'
const G3 = '333333333333333333'
const bits = (...b: bigint[]): string => b.reduce((a, c) => a | c, 0n).toString()

const ev = (type: NormalizedEvent['type'], guildId = G1): NormalizedEvent => ({ id: 1, guildId, type, at: '2026-01-01T00:00:00.000Z', data: {} })

describe('permission refresher', () => {
  let store: Store
  let perms: Record<string, string | Error>
  let cb: ((e: NormalizedEvent) => void) | null
  let onDemoted: ReturnType<typeof vi.fn<(userId: string, guildId: string, reason: string) => void>>
  let fetchMemberPermissions: ReturnType<typeof vi.fn>
  let r: ReturnType<typeof createPermissionRefresher>
  const clock = 1_000_000

  const session = (over: Record<string, unknown> = {}) =>
    store.oauth.saveSession({
      familyId: 'fam', accessHash: 'a', refreshHash: 'r', clientId: 'c', userId: 'u1', userName: 'alice',
      guilds: { [G1]: bits(PERM.ADMINISTRATOR), [G2]: bits(PERM.MANAGE_GUILD) },
      accessExpiresAt: clock + 60_000, refreshExpiresAt: clock + 120_000, revoked: false, ...over,
    })

  beforeEach(() => {
    store = openStore(':memory:')
    perms = {}
    cb = null
    onDemoted = vi.fn<(userId: string, guildId: string, reason: string) => void>()
    fetchMemberPermissions = vi.fn(async (g: string, u: string) => {
      const v = perms[`${g}:${u}`]
      if (v instanceof Error) throw v
      if (v === undefined) throw new McpToolError('not_found', 'member not found')
      return v
    })
    r = createPermissionRefresher({
      store,
      discord: { fetchMemberPermissions } as never,
      subscribe: (c) => {
        cb = c
        return () => {
          cb = null
        }
      },
      onDemoted,
      now: () => clock,
    })
  })

  const guildsOf = () => store.oauth.getByAccessHash('a')!.guilds

  it('keeps guilds where the user still manages and updates their bits', async () => {
    session()
    perms[`${G1}:u1`] = bits(PERM.ADMINISTRATOR, PERM.BAN_MEMBERS)
    perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
    await r.refreshUser('u1')
    expect(guildsOf()).toEqual({ [G1]: bits(PERM.ADMINISTRATOR, PERM.BAN_MEMBERS), [G2]: bits(PERM.MANAGE_GUILD) })
    expect(onDemoted).not.toHaveBeenCalled()
  })

  it('drops a guild where the user lost ADMINISTRATOR and MANAGE_GUILD and calls onDemoted', async () => {
    session()
    perms[`${G1}:u1`] = bits(PERM.MANAGE_MESSAGES)
    perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
    await r.refreshUser('u1')
    expect(Object.keys(guildsOf())).toEqual([G2])
    expect(onDemoted).toHaveBeenCalledTimes(1)
    expect(onDemoted).toHaveBeenCalledWith('u1', G1, expect.stringContaining(G1))
  })

  it('drops a guild the user left', async () => {
    session()
    perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
    await r.refreshUser('u1')
    expect(Object.keys(guildsOf())).toEqual([G2])
    expect(onDemoted).toHaveBeenCalledWith('u1', G1, expect.stringContaining(G1))
  })

  it('keeps stale permissions on transient errors', async () => {
    session()
    perms[`${G1}:u1`] = new McpToolError('internal', 'boom')
    perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
    await r.refreshUser('u1')
    expect(Object.keys(guildsOf()).sort()).toEqual([G1, G2])
    expect(onDemoted).not.toHaveBeenCalled()
  })

  it('revokes the session when no guilds remain', async () => {
    session()
    await r.refreshUser('u1')
    expect(store.oauth.getByAccessHash('a')!.revoked).toBe(true)
    expect(onDemoted).toHaveBeenCalledTimes(2)
  })

  it('member and role events refresh users present in that guild', async () => {
    session()
    perms[`${G1}:u1`] = bits(PERM.MANAGE_MESSAGES)
    perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
    r.start()
    cb!(ev('role_update', G1))
    await r.idle()
    expect(Object.keys(guildsOf())).toEqual([G2])
  })

  it.each(['role_create', 'role_update', 'role_delete'] as const)('%s triggers a guild-wide refresh', async (type) => {
    session()
    perms[`${G1}:u1`] = bits(PERM.ADMINISTRATOR)
    perms[`${G2}:u1`] = bits(PERM.ADMINISTRATOR)
    r.start()
    cb!(ev(type, G1))
    await r.idle()
    expect(fetchMemberPermissions).toHaveBeenCalled()
  })

  it.each(['member_update', 'member_join', 'member_remove', 'member_ban', 'member_unban'] as const)(
    '%s refreshes only the affected user',
    async (type) => {
      session()
      session({ familyId: 'fam9', accessHash: 'a9', refreshHash: 'r9', userId: 'u9', userName: 'bob' })
      perms[`${G1}:u1`] = bits(PERM.MANAGE_MESSAGES)
      perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
      r.start()
      cb!({ ...ev(type, G1), data: { user_id: 'u1' } })
      await r.idle()
      expect(fetchMemberPermissions.mock.calls.every((c) => c[1] === 'u1')).toBe(true)
      expect(Object.keys(guildsOf())).toEqual([G2])
    },
  )

  it('member events for users without a session or without user_id do nothing', async () => {
    session()
    r.start()
    cb!({ ...ev('member_update', G1), data: { user_id: 'stranger' } })
    cb!(ev('member_ban', G1))
    await r.idle()
    expect(fetchMemberPermissions).not.toHaveBeenCalled()
  })

  it('fails closed after consecutive fetch failures', async () => {
    session()
    perms[`${G1}:u1`] = new McpToolError('internal', 'boom')
    perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
    await r.refreshUser('u1')
    await r.refreshUser('u1')
    expect(Object.keys(guildsOf()).sort()).toEqual([G1, G2])
    await r.refreshUser('u1')
    expect(Object.keys(guildsOf())).toEqual([G2])
    expect(onDemoted).toHaveBeenCalledWith('u1', G1, expect.any(String))
  })

  it('a successful fetch resets the failure count', async () => {
    session()
    perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
    perms[`${G1}:u1`] = new McpToolError('internal', 'boom')
    await r.refreshUser('u1')
    await r.refreshUser('u1')
    perms[`${G1}:u1`] = bits(PERM.ADMINISTRATOR)
    await r.refreshUser('u1')
    perms[`${G1}:u1`] = new McpToolError('internal', 'boom')
    await r.refreshUser('u1')
    await r.refreshUser('u1')
    expect(Object.keys(guildsOf()).sort()).toEqual([G1, G2])
  })

  it('unrelated events and unrelated guilds do nothing', async () => {
    session()
    r.start()
    cb!(ev('message_create', G1))
    cb!(ev('channel_update', G1))
    cb!({ ...ev('member_join', G3), data: { user_id: 'u1' } })
    await r.idle()
    expect(fetchMemberPermissions).not.toHaveBeenCalled()
  })

  it('ignores revoked and expired sessions', async () => {
    session({ revoked: true })
    r.start()
    cb!(ev('member_remove', G1))
    await r.idle()
    expect(fetchMemberPermissions).not.toHaveBeenCalled()
  })

  it('start is idempotent and stop unsubscribes', () => {
    r.start()
    r.start()
    expect(cb).not.toBeNull()
    r.stop()
    expect(cb).toBeNull()
  })

  it('updates all session families of the user', async () => {
    session()
    session({ familyId: 'fam2', accessHash: 'a2', refreshHash: 'r2', guilds: { [G1]: bits(PERM.ADMINISTRATOR) } })
    perms[`${G1}:u1`] = bits(PERM.MANAGE_MESSAGES)
    perms[`${G2}:u1`] = bits(PERM.MANAGE_GUILD)
    await r.refreshUser('u1')
    expect(store.oauth.getByAccessHash('a2')!.revoked).toBe(true)
    expect(Object.keys(guildsOf())).toEqual([G2])
  })

  it('refreshSession supports the beforeIssue hook', async () => {
    session()
    perms[`${G1}:u1`] = bits(PERM.ADMINISTRATOR)
    perms[`${G2}:u1`] = bits(PERM.MANAGE_MESSAGES)
    const s = await r.refreshSession(store.oauth.getByAccessHash('a')!)
    expect(Object.keys(s.guilds)).toEqual([G1])
    expect(Object.keys(guildsOf())).toEqual([G1])
  })
})
