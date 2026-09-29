import { describe, expect, it } from 'vitest'
import { PERMISSION_PRESETS, buildInviteUrl } from '../../../src/cli/invite-url.js'

describe('invite url', () => {
  it('builds a bot-scope url with permissions', () => {
    const url = new URL(buildInviteUrl('111', 'admin'))
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('111')
    expect(url.searchParams.get('scope')).toBe('bot')
    expect(url.searchParams.get('permissions')).toBe('8')
  })
  it('accepts numeric bits', () => {
    expect(new URL(buildInviteUrl('1', 8192n)).searchParams.get('permissions')).toBe('8192')
  })
  it('rejects unknown preset', () => {
    expect(() => buildInviteUrl('1', 'root')).toThrow(/unknown preset/i)
    expect(() => buildInviteUrl('1', 'toString')).toThrow(/unknown preset/i)
  })
  it('presets are cumulative', () => {
    const { read, moderator, manager, admin } = PERMISSION_PRESETS
    expect(moderator & read).toBe(read)
    expect(manager & moderator).toBe(moderator)
    expect(admin).toBe(8n)
  })
})
