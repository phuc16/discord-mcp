import { describe, expect, it } from 'vitest'
import { PERM, tierFromDiscordPermissions } from '../../../src/safety/permissions.js'

describe('tierFromDiscordPermissions', () => {
  const groups = ['guild', 'channels', 'threads', 'roles', 'members', 'moderation', 'messages', 'webhooks', 'scheduled_events', 'invites', 'emojis', 'meta']

  it('administrator is destructive for every group', () => {
    for (const g of groups) expect(tierFromDiscordPermissions(PERM.ADMINISTRATOR, g)).toBe('destructive')
  })

  it('administrator rule applies to audit_log too', () => {
    expect(tierFromDiscordPermissions(PERM.ADMINISTRATOR, 'audit_log')).toBe('destructive')
  })

  const table: [string, bigint][] = [
    ['guild', PERM.MANAGE_GUILD],
    ['channels', PERM.MANAGE_CHANNELS],
    ['threads', PERM.MANAGE_THREADS],
    ['roles', PERM.MANAGE_ROLES],
    ['members', PERM.MANAGE_ROLES],
    ['moderation', PERM.BAN_MEMBERS],
    ['moderation', PERM.KICK_MEMBERS],
    ['moderation', PERM.MODERATE_MEMBERS],
    ['messages', PERM.MANAGE_MESSAGES],
    ['webhooks', PERM.MANAGE_WEBHOOKS],
    ['scheduled_events', PERM.MANAGE_EVENTS],
    ['invites', PERM.MANAGE_GUILD],
    ['emojis', PERM.MANAGE_GUILD_EXPRESSIONS],
  ]
  it.each(table)('%s becomes destructive with its permission', (group, bit) => {
    expect(tierFromDiscordPermissions(bit, group)).toBe('destructive')
  })

  it('group permission is not enough elsewhere', () => {
    expect(tierFromDiscordPermissions(PERM.MANAGE_CHANNELS, 'roles')).toBe('read')
  })

  it('manage_guild alone is write for non-guild groups', () => {
    expect(tierFromDiscordPermissions(PERM.MANAGE_GUILD, 'moderation')).toBe('write')
    expect(tierFromDiscordPermissions(PERM.MANAGE_GUILD, 'meta')).toBe('write')
  })

  it('ban permission plus manage_guild makes moderation destructive', () => {
    expect(tierFromDiscordPermissions(PERM.MANAGE_GUILD | PERM.BAN_MEMBERS, 'moderation')).toBe('destructive')
  })

  it('no permissions is read', () => {
    expect(tierFromDiscordPermissions(0n, 'guild')).toBe('read')
  })

  it('audit_log never exceeds read via its permission', () => {
    expect(tierFromDiscordPermissions(PERM.VIEW_AUDIT_LOG, 'audit_log')).toBe('read')
    expect(tierFromDiscordPermissions(PERM.MANAGE_GUILD | PERM.VIEW_AUDIT_LOG, 'audit_log')).toBe('read')
  })

  it('meta has no destructive permission', () => {
    expect(tierFromDiscordPermissions(PERM.MANAGE_CHANNELS | PERM.BAN_MEMBERS, 'meta')).toBe('read')
  })
})

describe('per-tool permission bits', () => {
  it.each([
    ['mod_kick', PERM.KICK_MEMBERS, PERM.BAN_MEMBERS | PERM.MODERATE_MEMBERS],
    ['mod_ban', PERM.BAN_MEMBERS, PERM.KICK_MEMBERS | PERM.MODERATE_MEMBERS],
    ['mod_timeout', PERM.MODERATE_MEMBERS, PERM.KICK_MEMBERS | PERM.BAN_MEMBERS],
    ['members_update_nick', PERM.MANAGE_NICKNAMES, PERM.MANAGE_ROLES | PERM.MANAGE_GUILD],
    ['members_move_voice', PERM.MOVE_MEMBERS, PERM.MANAGE_ROLES | PERM.MANAGE_GUILD],
    ['members_add_role', PERM.MANAGE_ROLES, PERM.MANAGE_NICKNAMES | PERM.MANAGE_GUILD],
  ])('%s needs its own bit', (tool, own, others) => {
    const group = tool.startsWith('mod_') ? 'moderation' : 'members'
    expect(tierFromDiscordPermissions(own, group, tool)).toBe('destructive')
    expect(tierFromDiscordPermissions(others, group, tool)).toBe('read')
    expect(tierFromDiscordPermissions(PERM.ADMINISTRATOR, group, tool)).toBe('destructive')
  })
})
