import { describe, expect, it } from 'vitest'
import { allTools } from '../../../src/tools/index.js'

describe('tool registry', () => {
  it('has at least 85 tools', () => {
    expect(allTools.length).toBeGreaterThanOrEqual(85)
  })
  it('has unique snake_case names', () => {
    const names = allTools.map((t) => t.name)
    expect(new Set(names).size).toBe(names.length)
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/)
  })
  it('has group, description stating the tier, and a valid tier', () => {
    for (const t of allTools) {
      expect(t.group, t.name).toMatch(/^[a-z][a-z_]*$/)
      expect(['read', 'write', 'destructive'], t.name).toContain(t.tier)
      expect(t.description.length, t.name).toBeGreaterThan(10)
      expect(t.description, t.name).toContain(`(${t.tier})`)
    }
  })
  it('gives every destructive tool a preview', () => {
    for (const t of allTools.filter((x) => x.tier === 'destructive')) expect(t.preview, t.name).toBeTypeOf('function')
  })
  it('requires guild_id on every scoped tool', () => {
    for (const t of allTools.filter((x) => !x.unscoped)) {
      expect(Object.keys(t.input.shape), t.name).toContain('guild_id')
    }
  })
  it('keeps unscoped tools read tier without guild_id', () => {
    const unscoped = allTools.filter((x) => x.unscoped)
    expect(unscoped.map((t) => t.name).sort()).toEqual(['guild_list', 'server_policy', 'server_whoami'])
    for (const t of unscoped) {
      expect(t.tier, t.name).toBe('read')
      expect(t.guildFrom({}), t.name).toBeNull()
    }
  })
  it('scoped tools resolve guild from input', () => {
    const g = '1'.repeat(18)
    for (const t of allTools.filter((x) => !x.unscoped)) expect(t.guildFrom({ guild_id: g }), t.name).toBe(g)
  })
  it('contains the spec inventory', () => {
    const names = new Set(allTools.map((t) => t.name))
    for (const n of ['guild_prune', 'channels_delete', 'threads_delete', 'roles_bulk_assign', 'mod_ban', 'mod_bulk_ban', 'messages_purge', 'webhooks_delete', 'sevents_delete', 'invites_delete', 'emojis_delete', 'stickers_delete', 'audit_query', 'rules_test', 'events_poll']) {
      expect(names.has(n), n).toBe(true)
    }
  })
})
