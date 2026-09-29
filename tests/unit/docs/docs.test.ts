import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../../..')
const read = (p: string): string => readFileSync(resolve(root, p), 'utf8')
const files = ['README.md', 'docs/getting-started.md', 'docs/smoke-checklist.md']

describe('getting-started', () => {
  const doc = read('docs/getting-started.md')
  it.each(['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUBLIC_BASE_URL'])('mentions %s', (name) => {
    expect(doc).toContain(name)
  })
  it('documents LOG_LEVEL and DISCORD_MCP_CONFIG', () => {
    expect(doc).toContain('LOG_LEVEL')
    expect(doc).toContain('DISCORD_MCP_CONFIG')
  })
  it.each(['invite-url', '--check', 'claude mcp add', 'claude mcp add --transport http', 'Server Members', 'Message Content', '/callback', 'config.yaml'])(
    'mentions %s',
    (s) => {
      expect(doc).toContain(s)
    },
  )
  it('keeps the spec steps in order', () => {
    const order = ['Create the Discord application', 'Add the bot', 'redirect URI', 'Invite the bot', 'Order the bot role', 'config.yaml', 'Check it', 'Connect Claude Code', 'Smoke test']
    const at = order.map((s) => doc.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })
})

describe('http events', () => {
  it('documents events_poll fallback', () => {
    const doc = read('docs/getting-started.md')
    expect(doc).toContain('events_poll')
    expect(doc).toContain('resources/updated')
  })
})

describe('relative links', () => {
  it.each(files)('%s links resolve', (file) => {
    const text = read(file)
    const targets = [...text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)].map((m) => m[1]!).filter((t) => !/^[a-z]+:/i.test(t))
    for (const t of targets) expect(existsSync(resolve(root, dirname(file), t)), `${file} -> ${t}`).toBe(true)
  })
})

describe('README tutorial', () => {
  const doc = read('README.md')
  const sections = [
    '## 1. What it is and how it works',
    '## 2. Prerequisites',
    '## 3. Discord developer portal setup',
    '## 4. Install and build',
    '## 5. Configure',
    '## 6. Verify',
    '## 7. Use it',
    '## 8. Using the tools',
    '## 9. Events and rules',
    '## 10. Tool reference',
    '## 11. Security notes and known limitations',
    '## 12. Troubleshooting',
  ]
  it('has the sections in order', () => {
    const at = sections.map((s) => doc.indexOf(s))
    expect(at.every((i) => i >= 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
  })
  it.each([
    'Server Members Intent',
    'Used disallowed intents',
    'invite-url',
    'pnpm install',
    'pnpm build',
    '.env.example',
    'config.example.yaml',
    '--check',
    '--online',
    'claude mcp add',
    '--transport http',
    'claude_desktop_config.json',
    'PUBLIC_BASE_URL',
    '/callback',
    'supervisorctl restart discord-mcp',
    'confirm_token',
    'confirm_invalid',
    'dry_run',
    'audit_query',
    'events_poll',
    'discord://guild/{guild_id}/events',
    'rules_create',
    'rules_test',
    'member_join',
    'guild_not_allowed',
    'tier_exceeded',
    'missing_permissions',
    'rate_limited',
    'Role hierarchy',
    'bulk_per_minute',
    'retention_hours',
    'tools.deny',
  ])('mentions %s', (s) => {
    expect(doc).toContain(s)
  })
  it('lists every registered tool in the reference', async () => {
    const { allTools } = await import('../../../src/tools/index.js')
    const missing = allTools.filter((t) => !doc.includes(`\`${t.name}\``)).map((t) => t.name)
    expect(missing).toEqual([])
  })
  it('documents every env var', () => {
    for (const name of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUBLIC_BASE_URL', 'DISCORD_MCP_CONFIG', 'LOG_LEVEL']) expect(doc).toContain(name)
  })
})

describe('.env.example', () => {
  it('lists every documented variable', () => {
    const env = read('.env.example')
    for (const name of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUBLIC_BASE_URL', 'DISCORD_MCP_CONFIG', 'LOG_LEVEL']) expect(env).toContain(`${name}=`)
  })
})

describe('config example', () => {
  it('parses with the real schema', async () => {
    const { parse } = await import('yaml')
    const { ConfigSchema } = await import('../../../src/contracts/index.js')
    expect(() => ConfigSchema.parse(parse(read('config.example.yaml')))).not.toThrow()
  })
})
