import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { runCheck } from '../../../src/cli/check.js'
import type { DiscordPort } from '../../../src/contracts/index.js'

const cfg = (): string => {
  const p = join(mkdtempSync(join(tmpdir(), 'chk-')), 'c.yaml')
  writeFileSync(p, 'guilds:\n  "123456789012345678":\n    max_tier: read\n')
  return p
}

describe('runCheck', () => {
  it('passes with valid config and token', async () => {
    const r = await runCheck({ configPath: cfg(), http: false, online: false, env: { DISCORD_BOT_TOKEN: 't' } })
    expect(r).toEqual({ ok: true, problems: [] })
  })
  it('reports each missing env var for http', async () => {
    const r = await runCheck({ configPath: cfg(), http: true, online: false, env: {} })
    expect(r.ok).toBe(false)
    for (const name of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUBLIC_BASE_URL']) {
      expect(r.problems.some((p) => p.includes(name))).toBe(true)
    }
  })
  it('reports bad config', async () => {
    const r = await runCheck({ configPath: '/nope.yaml', http: false, online: false, env: { DISCORD_BOT_TOKEN: 't' } })
    expect(r.ok).toBe(false)
    expect(r.problems[0]).toMatch(/cannot read config/)
  })
  it('online check flags guilds the bot is not in', async () => {
    const port = { listBotGuildIds: async () => ['999'] } as unknown as DiscordPort
    const r = await runCheck({ configPath: cfg(), http: false, online: true, env: { DISCORD_BOT_TOKEN: 't' }, discord: () => port })
    expect(r.problems).toEqual(['bot is not a member of configured guild 123456789012345678'])
  })
  it('online check passes when bot is in guild', async () => {
    const port = { listBotGuildIds: async () => ['123456789012345678'] } as unknown as DiscordPort
    const r = await runCheck({ configPath: cfg(), http: false, online: true, env: { DISCORD_BOT_TOKEN: 't' }, discord: () => port })
    expect(r.ok).toBe(true)
  })
  it('online check reports discord failures', async () => {
    const port = {
      listBotGuildIds: async () => {
        throw new Error('boom')
      },
    } as unknown as DiscordPort
    const r = await runCheck({ configPath: cfg(), http: false, online: true, env: { DISCORD_BOT_TOKEN: 't' }, discord: () => port })
    expect(r.problems[0]).toMatch(/boom/)
  })
  it('rejects an http PUBLIC_BASE_URL on a public host in http mode', async () => {
    const env = { DISCORD_BOT_TOKEN: 't', DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 's', PUBLIC_BASE_URL: 'http://mcp.example.com' }
    const r = await runCheck({ configPath: cfg(), http: true, online: false, env })
    expect(r.ok).toBe(false)
    expect(r.problems.some((p) => p.includes('PUBLIC_BASE_URL') && p.includes('https'))).toBe(true)
  })
  it('reports the discord redirect uri in http mode', async () => {
    const env = { DISCORD_BOT_TOKEN: 't', DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 's', PUBLIC_BASE_URL: 'https://mcp.example.com' }
    const r = await runCheck({ configPath: cfg(), http: true, online: false, env })
    expect(r).toEqual({ ok: true, problems: [], redirectUri: 'https://mcp.example.com/callback' })
  })
})
