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

describe('README', () => {
  const doc = read('README.md')
  it('covers the essentials', () => {
    for (const s of ['docs/getting-started.md', 'config.example.yaml', 'docs/smoke-checklist.md', 'confirm_token', 'pnpm check']) expect(doc).toContain(s)
  })
})
