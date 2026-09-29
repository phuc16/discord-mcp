import { describe, expect, it } from 'vitest'
import { McpToolError } from '../../../src/contracts/index.js'
import type { Principal } from '../../../src/contracts/index.js'
import {
  createGuards,
  assertCanActOnMember,
  assertCanActOnRole,
  assertCanGrantPermissions,
  assertCanPlaceRole,
  callerHighestPosition,
} from '../../../src/safety/escalation.js'
import { PERM } from '../../../src/safety/permissions.js'

const G = '111111111111111111'
const OWNER = '900000000000000001'
const CALLER = '900000000000000002'
const LOW = '900000000000000003'
const HIGH = '900000000000000004'

const user = (bits: bigint): Principal => ({ kind: 'user', userId: CALLER, userName: 'c', guilds: { [G]: bits.toString() } })
const stdio: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }

const roles = [
  { id: G, position: 0 },
  { id: 'r1', position: 1 },
  { id: 'r5', position: 5 },
  { id: 'r9', position: 9 },
]
const members: Record<string, string[]> = { [CALLER]: ['r5'], [LOW]: ['r1'], [HIGH]: ['r9'], [OWNER]: [] }
const discord = {
  getGuild: async () => ({ id: G, owner_id: OWNER }),
  getMember: async (_g: string, u: string) => ({ id: u, roles: members[u] ?? [] }),
  listRoles: async () => roles,
}
const ctxFor = (p: Principal, userId: string | null = p.userId) => ({ discord, principal: { ...p, userId } })

describe('assertCanGrantPermissions', () => {
  it('rejects bits the caller lacks, including Administrator', () => {
    const p = user(PERM.MANAGE_GUILD | PERM.MANAGE_ROLES)
    expect(() => assertCanGrantPermissions(p, G, PERM.ADMINISTRATOR)).toThrowError(expect.objectContaining({ code: 'missing_permissions' }))
    expect(() => assertCanGrantPermissions(p, G, (PERM.MANAGE_ROLES | PERM.BAN_MEMBERS).toString())).toThrowError(expect.objectContaining({ code: 'missing_permissions' }))
  })
  it('allows subsets, and anything for administrators and non-user principals', () => {
    expect(() => assertCanGrantPermissions(user(PERM.MANAGE_ROLES | PERM.MANAGE_GUILD), G, PERM.MANAGE_ROLES)).not.toThrow()
    expect(() => assertCanGrantPermissions(user(PERM.ADMINISTRATOR), G, PERM.ADMINISTRATOR | PERM.BAN_MEMBERS)).not.toThrow()
    expect(() => assertCanGrantPermissions(stdio, G, PERM.ADMINISTRATOR)).not.toThrow()
  })
  it('rejects a user with no bits for the guild and malformed input', () => {
    expect(() => assertCanGrantPermissions({ ...user(0n), guilds: {} }, G, 8n)).toThrowError(expect.objectContaining({ code: 'missing_permissions' }))
    expect(() => assertCanGrantPermissions(user(0n), G, 'abc')).toThrowError(expect.objectContaining({ code: 'invalid_input' }))
  })
})

describe('hierarchy', () => {
  const caller = ctxFor(user(PERM.MANAGE_ROLES))

  it('caller highest position', async () => {
    expect(await callerHighestPosition(caller, G)).toBe(5)
    expect(await callerHighestPosition(ctxFor(stdio), G)).toBe(Number.POSITIVE_INFINITY)
    expect(await callerHighestPosition(ctxFor(user(0n), OWNER), G)).toBe(Number.POSITIVE_INFINITY)
  })
  it('roles: below allowed, equal/above rejected, unknown not_found', async () => {
    await expect(assertCanActOnRole(caller, G, 'r1')).resolves.toBeUndefined()
    await expect(assertCanActOnRole(caller, G, 'r5')).rejects.toMatchObject({ code: 'missing_permissions' })
    await expect(assertCanActOnRole(caller, G, 'r9')).rejects.toMatchObject({ code: 'missing_permissions' })
    await expect(assertCanActOnRole(caller, G, 'nope')).rejects.toMatchObject({ code: 'not_found' })
    await expect(assertCanActOnRole(ctxFor(stdio), G, 'r9')).resolves.toBeUndefined()
  })
  it('role placement must be strictly below the caller', async () => {
    await expect(assertCanPlaceRole(caller, G, 4)).resolves.toBeUndefined()
    await expect(assertCanPlaceRole(caller, G, 5)).rejects.toMatchObject({ code: 'missing_permissions' })
  })
  it('members: lower ok; higher, owner and self rejected unless allowSelf', async () => {
    await expect(assertCanActOnMember(caller, G, LOW)).resolves.toBeUndefined()
    await expect(assertCanActOnMember(caller, G, HIGH)).rejects.toMatchObject({ code: 'missing_permissions' })
    await expect(assertCanActOnMember(caller, G, OWNER)).rejects.toMatchObject({ code: 'missing_permissions' })
    await expect(assertCanActOnMember(caller, G, CALLER)).rejects.toMatchObject({ code: 'missing_permissions' })
    await expect(assertCanActOnMember(caller, G, CALLER, { allowSelf: true })).resolves.toBeUndefined()
  })
  it('guild owner may act on anyone but themselves', async () => {
    const owner = ctxFor(user(0n), OWNER)
    await expect(assertCanActOnMember(owner, G, HIGH)).resolves.toBeUndefined()
    await expect(assertCanActOnRole(owner, G, 'r9')).resolves.toBeUndefined()
  })
  it('non-member targets (ban by id) are allowed', async () => {
    const d = { ...discord, getMember: async (_g: string, u: string) => { if (u === 'ghost') throw new McpToolError('not_found', 'x'); return { id: u, roles: members[u] ?? [] } } }
    await expect(assertCanActOnMember({ discord: d, principal: caller.principal }, G, 'ghost')).resolves.toBeUndefined()
  })
})

describe('createGuards', () => {
  it('binds principal and discord', async () => {
    const g = createGuards(ctxFor(user(PERM.MANAGE_ROLES)))
    expect(() => g.assertCanGrantPermissions(G, PERM.ADMINISTRATOR)).toThrow()
    await expect(g.assertCanActOnRole(G, 'r9')).rejects.toBeDefined()
    await expect(g.assertCanActOnMember(G, LOW)).resolves.toBeUndefined()
    await expect(g.assertCanPlaceRole(G, 6)).rejects.toBeDefined()
  })
})
