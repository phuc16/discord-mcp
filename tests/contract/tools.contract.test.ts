import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { buildToolRegistry } from '../../src/server/registry.js'
import { allTools } from '../../src/tools/index.js'

const prefixes: Record<string, string[]> = {
  threads: ['threads_', 'forum_'],
  moderation: ['mod_', 'automod_'],
  messages: ['messages_', 'reactions_'],
  scheduled_events: ['sevents_'],
  emojis: ['emojis_', 'stickers_'],
  meta: ['server_', 'events_', 'rules_', 'audit_query'],
}

const allowedPrefixes = (group: string): string[] => prefixes[group] ?? [`${group}_`]

describe('tool definitions', () => {
  it('has at least 85 tools', () => {
    expect(allTools.length).toBeGreaterThanOrEqual(85)
  })

  it('has unique names', () => {
    const seen = new Set<string>()
    const dupes = allTools.map((t) => t.name).filter((n) => (seen.has(n) ? true : (seen.add(n), false)))
    expect(dupes).toEqual([])
  })

  describe.each(allTools.map((t) => [t.name, t] as const))('%s', (_name, tool) => {
    it('has snake_case name', () => {
      expect(tool.name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/)
    })
    it('uses its group prefix', () => {
      expect(allowedPrefixes(tool.group).some((p) => tool.name.startsWith(p))).toBe(true)
    })
    it('describes itself and names its tier', () => {
      expect(tool.description.trim().length).toBeGreaterThan(0)
      expect(tool.description.toLowerCase()).toContain(tool.tier)
    })
    it('has a zod object input', () => {
      expect(tool.input).toBeInstanceOf(z.ZodObject)
    })
    it('binds guild_id unless unscoped', () => {
      if (tool.unscoped) expect(tool.tier).toBe('read')
      else expect(tool.input.shape).toHaveProperty('guild_id')
    })
    it('previews when destructive', () => {
      if (tool.tier === 'destructive') expect(typeof tool.preview).toBe('function')
    })
  })
})

describe('built registry', () => {
  const registry = buildToolRegistry(allTools, [])

  it('registers every tool', () => {
    expect(registry.size).toBe(allTools.length)
  })
  it.each(allTools.map((t) => [t.name, t.tier] as const))('%s confirm_token matches tier %s', (name, tier) => {
    const shape = registry.get(name)!.input.shape
    if (tier === 'destructive') expect(shape).toHaveProperty('confirm_token')
    else expect(shape).not.toHaveProperty('confirm_token')
  })
  it('excludes denied tools', () => {
    const first = allTools[0]!.name
    expect(buildToolRegistry(allTools, [first]).has(first)).toBe(false)
  })
})

describe('tool caps', () => {
  const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => String(300000000000000000n + BigInt(i)))
  const find = (name: string) => {
    const t = allTools.find((x) => x.name === name)
    if (!t) throw new Error(`tool ${name} missing`)
    return t
  }
  const gid = '100000000000000001'

  it('messages_purge rejects limit 1001', () => {
    const r = find('messages_purge').input.safeParse({ guild_id: gid, channel_id: gid, limit: 1001 })
    expect(r.success).toBe(false)
    expect(JSON.stringify((r as { error: unknown }).error)).toMatch(/limit/)
  })
  it('roles_bulk_assign rejects 201 targets', () => {
    const shape = find('roles_bulk_assign').input.shape
    const arrayKey = Object.keys(shape).find((k) => shape[k] instanceof z.ZodArray)
    expect(arrayKey).toBeDefined()
    const base = { guild_id: gid, role_id: gid, [arrayKey as string]: ids(201) }
    expect(find('roles_bulk_assign').input.safeParse(base).success).toBe(false)
    expect(find('roles_bulk_assign').input.safeParse({ ...base, [arrayKey as string]: ids(200) }).success).toBe(true)
  })
  it('mod_bulk_ban rejects 201 targets', () => {
    const shape = find('mod_bulk_ban').input.shape
    const arrayKey = Object.keys(shape).find((k) => shape[k] instanceof z.ZodArray)
    expect(arrayKey).toBeDefined()
    const base = { guild_id: gid, [arrayKey as string]: ids(201) }
    expect(find('mod_bulk_ban').input.safeParse(base).success).toBe(false)
    expect(find('mod_bulk_ban').input.safeParse({ ...base, [arrayKey as string]: ids(200) }).success).toBe(true)
  })
})

describe('tool tier snapshot', () => {
  it('matches the reviewed name:tier list', () => {
    const list = allTools.map((t) => `${t.name}:${t.tier}`).sort()
    expect(list.join('\n')).toMatchSnapshot()
  })
})
