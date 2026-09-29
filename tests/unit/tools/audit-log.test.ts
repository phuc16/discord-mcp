import { describe, expect, it } from 'vitest'
import { auditLogTools } from '../../../src/tools/audit-log.js'
import { G, byName, id, makeCtx, run } from './helpers.js'

const t = (name: string) => byName(auditLogTools, name)
const U = id('4')
const payload = { audit_log_entries: [{ id: id('1') }] }

describe('audit log tools', () => {
  it('audit_log_list forwards limit and before', async () => {
    const ctx = makeCtx({ discord: { listAuditLog: async () => payload } })
    expect(await run(t('audit_log_list'), ctx, { guild_id: G, limit: 20, before: id('9') })).toEqual(payload)
    expect(ctx.calls[0]).toEqual({ method: 'listAuditLog', args: [G, { limit: 20, before: id('9') }] })
  })
  it('audit_log_list omits unset fields and bounds limit', async () => {
    const ctx = makeCtx({ discord: { listAuditLog: async () => payload } })
    await run(t('audit_log_list'), ctx, { guild_id: G })
    expect(ctx.calls[0]?.args[1]).toEqual({})
    expect(t('audit_log_list').input.safeParse({ guild_id: G, limit: 101 }).success).toBe(false)
    expect(t('audit_log_list').input.safeParse({ guild_id: G, limit: 0 }).success).toBe(false)
  })
  it('audit_log_by_user filters by user', async () => {
    const ctx = makeCtx({ discord: { listAuditLog: async () => payload } })
    await run(t('audit_log_by_user'), ctx, { guild_id: G, user_id: U, limit: 5 })
    expect(ctx.calls[0]).toEqual({ method: 'listAuditLog', args: [G, { user_id: U, limit: 5 }] })
  })
  it('audit_log_by_action filters by action type', async () => {
    const ctx = makeCtx({ discord: { listAuditLog: async () => payload } })
    await run(t('audit_log_by_action'), ctx, { guild_id: G, action_type: 22 })
    expect(ctx.calls[0]?.args).toEqual([G, { action_type: 22 }])
    expect(t('audit_log_by_action').input.safeParse({ guild_id: G, action_type: 1.5 }).success).toBe(false)
  })
  it('are all read tier and bound to guild_id', () => {
    for (const tool of auditLogTools) {
      expect(tool.tier).toBe('read')
      expect(tool.guildFrom({ guild_id: G })).toBe(G)
    }
  })
})
