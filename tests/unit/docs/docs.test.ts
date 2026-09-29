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

describe('round 2 documentation', () => {
  const readme = read('README.md')
  it.each(['trust_proxy', 'allowed_redirect_uris', 'max_clients', 'max_sessions_per_principal', 'allow_token_confirm', 'max_per_guild', 'min_cooldown_sec', '127.0.0.1', '0.0.0.0', 'elicitation', 'already in use', 'SIGHUP', '503'])(
    'README covers %s',
    (s) => {
      expect(readme).toContain(s)
    },
  )
  it('getting-started explains elicitation, bind address and database lock', () => {
    const doc = read('docs/getting-started.md')
    for (const s of ['elicitation', 'allow_token_confirm', '127.0.0.1', 'trust_proxy', 'database_path']) expect(doc).toContain(s)
  })
  it('config.example.yaml sets every new field', async () => {
    const { parse } = await import('yaml')
    const cfg = parse(read('config.example.yaml')) as Record<string, Record<string, unknown>>
    expect(cfg.http).toMatchObject({ host: '127.0.0.1', trust_proxy: false, max_clients: 1000, max_sessions_per_principal: 10 })
    expect(cfg.safety).toEqual({ allow_token_confirm: false })
    expect(cfg.rules).toEqual({ max_per_guild: 50, min_cooldown_sec: 1 })
  })
})

describe('docker', () => {
  it('ships a Dockerfile that runs non-root and never copies env files', () => {
    const df = read('Dockerfile')
    expect(df).toMatch(/USER node/)
    expect(df).toMatch(/HEALTHCHECK/)
    expect(df).toMatch(/ENTRYPOINT \["node", "dist\/cli\/main.js"\]/)
    expect(df).not.toMatch(/COPY .*\.env/)
  })
  it('excludes secrets and state from the build context', () => {
    const ignore = read('.dockerignore').split('\n')
    for (const entry of ['.env*', '*.db', 'config.yaml', 'node_modules', 'tests', 'data/']) expect(ignore).toContain(entry)
  })
  it('gitignore keeps the data directory out of git', () => {
    expect(read('.gitignore').split('\n')).toContain('data/')
  })
  it('compose file parses and binds loopback', async () => {
    const { parse } = await import('yaml')
    interface Service { ports: string[]; env_file: string; volumes: string[]; restart: string }
    const c = parse(read('docker-compose.yml')) as { services: Record<string, Service> }
    const svc = c.services['discord-mcp']!
    expect(svc.ports).toEqual(['127.0.0.1:8787:8787'])
    expect(svc.env_file).toBe('.env')
    expect(svc.restart).toBe('unless-stopped')
    expect(svc.volumes).toContain('./data:/data')
  })
  it('docker config example parses and binds 0.0.0.0 with a /data database', async () => {
    const { parse } = await import('yaml')
    const { ConfigSchema } = await import('../../../src/contracts/index.js')
    const cfg = ConfigSchema.parse(parse(read('config.docker.example.yaml')))
    expect(cfg.http.host).toBe('0.0.0.0')
    expect(cfg.database_path).toBe('/data/discord-mcp.db')
  })
  it('README has a Run with Docker section', () => {
    expect(read('README.md')).toContain('Run with Docker')
  })
  it('documents config errors, exit code 78 and the missing config troubleshooting entry', () => {
    const readme = read('README.md')
    for (const s of ['78', 'EX_CONFIG', 'chown 1000:1000', 'DISCORD_MCP_GUILD_ID', 'mkdir -p data && cp config.docker.example.yaml data/config.yaml', 'it does not exist']) expect(readme).toContain(s)
  })
})
