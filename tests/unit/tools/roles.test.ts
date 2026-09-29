import { describe, expect, it } from 'vitest'
import { McpToolError } from '../../../src/contracts/index.js'
import { rolesTools } from '../../../src/tools/roles.js'
import { G, byName, id, makeCtx, run, runPreview } from './helpers.js'

const t = (name: string) => byName(rolesTools, name)
const R = id('5')
const U = id('4')
const reason = 'via discord-mcp by tester (corr-1)'
const role = { id: R, name: 'mods' }
const listRoles = async () => [role, { id: id('6'), name: 'other' }]

describe('role reads', () => {
  it('roles_list', async () => {
    const ctx = makeCtx({ discord: { listRoles } })
    expect(await run(t('roles_list'), ctx, { guild_id: G })).toEqual({ items: await listRoles() })
  })
  it('roles_get finds role', async () => {
    const ctx = makeCtx({ discord: { listRoles } })
    expect(await run(t('roles_get'), ctx, { guild_id: G, role_id: R })).toEqual(role)
  })
  it('roles_get not_found when absent', async () => {
    const ctx = makeCtx({ discord: { listRoles } })
    await expect(run(t('roles_get'), ctx, { guild_id: G, role_id: id('8') })).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('role writes', () => {
  it('roles_create forwards spec', async () => {
    const ctx = makeCtx({ discord: { createRole: async () => role } })
    await run(t('roles_create'), ctx, { guild_id: G, name: 'mods', color: 255, permissions: '8', hoist: true })
    expect(ctx.calls[0]).toEqual({ method: 'createRole', args: [G, { name: 'mods', color: 255, permissions: '8', hoist: true }, reason] })
  })
  it('roles_create rejects non-numeric permissions', () => {
    expect(t('roles_create').input.safeParse({ guild_id: G, name: 'x', permissions: 'abc' }).success).toBe(false)
  })
  it('roles_update forwards patch', async () => {
    const ctx = makeCtx({ discord: { updateRole: async () => role } })
    await run(t('roles_update'), ctx, { guild_id: G, role_id: R, mentionable: true })
    expect(ctx.calls[0]).toEqual({ method: 'updateRole', args: [G, R, { mentionable: true }, reason] })
  })
  it('roles_reorder caps at 50', async () => {
    const ctx = makeCtx({ discord: { reorderRoles: async () => [] } })
    await run(t('roles_reorder'), ctx, { guild_id: G, positions: [{ id: R, position: 2 }] })
    expect(ctx.calls[0]).toEqual({ method: 'reorderRoles', args: [G, [{ id: R, position: 2 }]] })
    const many = Array.from({ length: 51 }, () => ({ id: R, position: 1 }))
    expect(t('roles_reorder').input.safeParse({ guild_id: G, positions: many }).success).toBe(false)
  })
  it('roles_assign and roles_remove', async () => {
    const ctx = makeCtx({ discord: { addMemberRole: async () => undefined, removeMemberRole: async () => undefined } })
    await run(t('roles_assign'), ctx, { guild_id: G, user_id: U, role_id: R })
    await run(t('roles_remove'), ctx, { guild_id: G, user_id: U, role_id: R })
    expect(ctx.calls).toEqual([
      { method: 'addMemberRole', args: [G, U, R, reason] },
      { method: 'removeMemberRole', args: [G, U, R, reason] },
    ])
  })
})

describe('roles_bulk_assign', () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => String(100000000000000000n + BigInt(i)))
  it('rejects 201 targets, accepts 200, rejects empty', () => {
    const s = t('roles_bulk_assign').input
    expect(s.safeParse({ guild_id: G, role_id: R, user_ids: ids(201) }).success).toBe(false)
    expect(s.safeParse({ guild_id: G, role_id: R, user_ids: ids(200) }).success).toBe(true)
    expect(s.safeParse({ guild_id: G, role_id: R, user_ids: [] }).success).toBe(false)
  })
  it('preview shows count and role name, no mutating call', async () => {
    const ctx = makeCtx({ discord: { listRoles } })
    const p = await runPreview(t('roles_bulk_assign'), ctx, { guild_id: G, role_id: R, user_ids: ids(3) })
    expect(p.affected).toEqual({ members: 3 })
    expect(p.summary).toContain('mods')
    expect(ctx.calls.map((c) => c.method)).toEqual(['listRoles'])
  })
  it('preview rejects role not in guild', async () => {
    const ctx = makeCtx({ discord: { listRoles } })
    await expect(runPreview(t('roles_bulk_assign'), ctx, { guild_id: G, role_id: id('8'), user_ids: ids(1) })).rejects.toMatchObject({ code: 'not_found' })
  })
  it('handler reports partial failures sequentially', async () => {
    const users = ids(3)
    const ctx = makeCtx({
      discord: {
        listRoles,
        addMemberRole: async (_g, u) => {
          if (u === users[1]) throw new McpToolError('missing_permissions', 'no')
          if (u === users[2]) throw new Error('boom')
        },
      },
    })
    expect(await run(t('roles_bulk_assign'), ctx, { guild_id: G, role_id: R, user_ids: users })).toEqual({
      ok: [users[0]],
      failed: [
        { user_id: users[1], code: 'missing_permissions' },
        { user_id: users[2], code: 'internal' },
      ],
    })
  })
})

describe('roles_delete', () => {
  it('preview counts members holding the role without mutating', async () => {
    const members = [{ id: U, roles: [R] }, { id: id('9'), roles: [] }, { id: id('3'), roles: [R, id('6')] }]
    const ctx = makeCtx({ discord: { listRoles, listMembers: async () => members } })
    const p = await runPreview(t('roles_delete'), ctx, { guild_id: G, role_id: R })
    expect(p.affected).toEqual({ members: 2 })
    expect(ctx.calls.map((c) => c.method)).toEqual(['listRoles', 'listMembers'])
  })
  it('preview pages members up to 1000', async () => {
    const page = Array.from({ length: 1000 }, (_, i) => ({ id: String(100000000000000000n + BigInt(i)), roles: [] }))
    const ctx = makeCtx({ discord: { listRoles, listMembers: async () => page } })
    await runPreview(t('roles_delete'), ctx, { guild_id: G, role_id: R })
    expect(ctx.calls.filter((c) => c.method === 'listMembers')).toHaveLength(1)
  })
  it('handler deletes with reason', async () => {
    const ctx = makeCtx({ discord: { deleteRole: async () => undefined } })
    await run(t('roles_delete'), ctx, { guild_id: G, role_id: R })
    expect(ctx.calls[0]).toEqual({ method: 'deleteRole', args: [G, R, reason] })
  })
})
