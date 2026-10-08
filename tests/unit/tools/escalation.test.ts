import { describe, expect, it } from 'vitest'
import { McpToolError, type Guards } from '../../../src/contracts/index.js'
import { channelsTools } from '../../../src/tools/channels.js'
import { membersTools } from '../../../src/tools/members.js'
import { moderationTools } from '../../../src/tools/moderation.js'
import { rolesTools } from '../../../src/tools/roles.js'
import { G, byName, id, allowAllGuards, makeCtx, run, runPreview } from './helpers.js'

const R = id('5')
const U = id('4')
const C = id('2')
const deny = (): never => {
  throw new McpToolError('missing_permissions', 'denied')
}
const denyAll: Guards = {
  assertCanGrantPermissions: deny,
  assertCanPlaceRole: async () => deny(),
  assertCanActOnRole: async () => deny(),
  assertCanActOnMember: async () => deny(),
}
const discord = new Proxy({} as Record<string, unknown>, {
  get: (_t, prop) => async () => {
    throw new Error(`mutation reached: ${String(prop)}`)
  },
}) as never
const tools = [...rolesTools, ...membersTools, ...moderationTools, ...channelsTools]
const t = (name: string) => byName(tools, name)

describe('escalation guards block mutations', () => {
  it.each<[string, Record<string, unknown>]>([
    ['roles_create', { guild_id: G, name: 'a', permissions: '8' }],
    ['roles_update', { guild_id: G, role_id: R, name: 'x' }],
    ['roles_reorder', { guild_id: G, positions: [{ id: R, position: 5 }] }],
    ['roles_assign', { guild_id: G, user_id: U, role_id: R }],
    ['roles_remove', { guild_id: G, user_id: U, role_id: R }],
    ['members_add_role', { guild_id: G, user_id: U, role_id: R }],
    ['members_remove_role', { guild_id: G, user_id: U, role_id: R }],
    ['members_update_nick', { guild_id: G, user_id: U, nick: 'n' }],
    ['members_disconnect_voice', { guild_id: G, user_id: U }],
    ['mod_timeout', { guild_id: G, user_id: U, duration_seconds: 60 }],
    ['mod_remove_timeout', { guild_id: G, user_id: U }],
    ['mod_kick', { guild_id: G, user_id: U }],
    ['mod_ban', { guild_id: G, user_id: U }],
    ['mod_bulk_ban', { guild_id: G, user_ids: [U] }],
  ])('%s is denied before any Discord mutation', async (name, input) => {
    const ctx = makeCtx({ guards: denyAll, discord })
    await expect(run(t(name), ctx, input)).rejects.toMatchObject({ code: 'missing_permissions' })
  })

  it('channels_set_permissions denies granted allow bits', async () => {
    const ctx = makeCtx({ guards: denyAll, discord: { getChannel: async () => ({ id: C, guild_id: G }) } })
    await expect(run(t('channels_set_permissions'), ctx, { guild_id: G, channel_id: C, overwrite_id: R, type: 0, allow: '8', deny: '0' })).rejects.toMatchObject({ code: 'missing_permissions' })
    expect(ctx.calls.map((c) => c.method)).toEqual(['getChannel'])
  })

  it('channels_clone denies copying overwrites the caller cannot grant', async () => {
    const src = { id: C, guild_id: G, name: 'c', type: 0, permission_overwrites: [{ id: R, type: 0, allow: '8', deny: '0' }] }
    const ctx = makeCtx({ guards: denyAll, discord: { getChannel: async () => src } })
    await expect(run(t('channels_clone'), ctx, { guild_id: G, channel_id: C })).rejects.toMatchObject({ code: 'missing_permissions' })
  })

  it('kick and ban previews are denied too', async () => {
    const ctx = makeCtx({ guards: denyAll, discord })
    await expect(runPreview(t('mod_kick'), ctx, { guild_id: G, user_id: U })).rejects.toMatchObject({ code: 'missing_permissions' })
    await expect(runPreview(t('mod_ban'), ctx, { guild_id: G, user_id: U })).rejects.toMatchObject({ code: 'missing_permissions' })
  })

  it('roles_bulk_assign denies the role up front and reports per-member denials', async () => {
    const ctx = makeCtx({ guards: denyAll, discord })
    await expect(run(t('roles_bulk_assign'), ctx, { guild_id: G, role_id: R, user_ids: [U] })).rejects.toMatchObject({ code: 'missing_permissions' })
    const memberDenied: Guards = { ...allowAllGuards, assertCanActOnMember: async (_g, u) => (u === U ? deny() : undefined) }
    const ok = id('6')
    const ctx2 = makeCtx({ guards: memberDenied, discord: { listRoles: async () => [{ id: R }], addMemberRole: async () => undefined } })
    expect(await run(t('roles_bulk_assign'), ctx2, { guild_id: G, role_id: R, user_ids: [U, ok] })).toEqual({ ok: [ok], failed: [{ user_id: U, code: 'missing_permissions' }] })
  })
})

describe('escalation guards pass through with correct arguments', () => {
  it('roles_create checks the exact permission bits', async () => {
    const seen: unknown[][] = []
    const guards: Guards = { ...allowAllGuards, assertCanGrantPermissions: (...a) => void seen.push(a) }
    const ctx = makeCtx({ guards, discord: { createRole: async () => ({ id: R }) } })
    await run(t('roles_create'), ctx, { guild_id: G, name: 'a', permissions: '2048' })
    expect(seen).toEqual([[G, '2048']])
  })
  it('roles_reorder places each role at its new position', async () => {
    const placed: number[] = []
    const guards: Guards = { ...allowAllGuards, assertCanPlaceRole: async (_g, p) => void placed.push(p) }
    const ctx = makeCtx({ guards, discord: { reorderRoles: async () => [] } })
    await run(t('roles_reorder'), ctx, { guild_id: G, positions: [{ id: R, position: 3 }, { id: id('6'), position: 4 }] })
    expect(placed).toEqual([3, 4])
  })
  it('role assignment allows self as target but ban does not', async () => {
    const opts: unknown[] = []
    const guards: Guards = { ...allowAllGuards, assertCanActOnMember: async (_g, _u, o) => void opts.push(o) }
    const ctx = makeCtx({ guards, discord: { addMemberRole: async () => undefined, banMember: async () => undefined } })
    await run(t('roles_assign'), ctx, { guild_id: G, user_id: U, role_id: R })
    await run(t('mod_ban'), ctx, { guild_id: G, user_id: U })
    expect(opts).toEqual([{ allowSelf: true }, undefined])
  })
})
