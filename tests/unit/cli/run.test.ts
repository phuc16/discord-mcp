import { describe, expect, it, vi } from 'vitest'
import { run } from '../../../src/cli/run.js'

describe('run', () => {
  it('invite-url prints url', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    const code = await run(['invite-url', '--client-id', '5', '--permissions', 'admin'], {})
    expect(code).toBe(0)
    expect(String(out.mock.calls[0]?.[0])).toContain('permissions=8')
    out.mockRestore()
  })
  it('invite-url falls back to env client id and numeric bits', async () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    expect(await run(['invite-url', '--permissions', '8192'], { DISCORD_CLIENT_ID: '7' })).toBe(0)
    expect(String(out.mock.calls[0]?.[0])).toContain('client_id=7')
    out.mockRestore()
  })
  it('invite-url unknown preset exits non-zero', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await run(['invite-url', '--client-id', '1', '--permissions', 'root'], {})).toBe(1)
    err.mockRestore()
  })
  it('invite-url without client id exits non-zero', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await run(['invite-url'], {})).toBe(1)
    err.mockRestore()
  })
  it('unknown subcommand exits non-zero', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await run(['bogus'], {})).toBe(1)
    err.mockRestore()
  })
  it('--check reports missing token', async () => {
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    expect(await run(['--check', '--config', '/nope.yaml'], {})).toBe(1)
    expect(String(err.mock.calls[0]?.[0])).toContain('DISCORD_BOT_TOKEN')
    err.mockRestore()
  })
})
