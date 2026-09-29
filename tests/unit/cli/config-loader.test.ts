import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ConfigError, EX_CONFIG, checkWritableDir } from '../../../src/cli/errors.js'
import { loadConfig } from '../../../src/cli/config-loader.js'

const write = (text: string): string => {
  const p = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'c.yaml')
  writeFileSync(p, text)
  return p
}

describe('loadConfig', () => {
  it('loads valid config with defaults', () => {
    const cfg = loadConfig(write('guilds:\n  "123456789012345678":\n    max_tier: write\n'))
    expect(cfg.guilds['123456789012345678']?.max_tier).toBe('write')
    expect(cfg.http.port).toBe(8787)
  })
  it('reports missing file', () => {
    expect(() => loadConfig('/nonexistent/x.yaml')).toThrow(/cannot read config file/)
  })
  it('reports invalid yaml', () => {
    expect(() => loadConfig(write('a: [unclosed'))).toThrow(/invalid YAML/)
  })
  it('lists each failing path', () => {
    const p = write('guilds:\n  abc:\n    max_tier: root\nhttp:\n  port: 0\n')
    let message = ''
    try {
      loadConfig(p)
    } catch (e) {
      message = (e as Error).message
    }
    expect(message).toMatch(/guilds/)
    expect(message).toMatch(/http\.port/)
  })
  it('rejects empty file', () => {
    expect(() => loadConfig(write(''))).toThrow(/guilds/)
  })
  it('resolves a relative database_path against the config directory', () => {
    const p = write('guilds:\n  "123456789012345678":\n    max_tier: write\ndatabase_path: ./data/x.db\n')
    expect(loadConfig(p).database_path).toBe(join(dirname(p), 'data', 'x.db'))
  })
  it('keeps absolute and in-memory database paths', () => {
    const g = 'guilds:\n  "123456789012345678":\n    max_tier: write\n'
    expect(loadConfig(write(`${g}database_path: /var/db/x.db\n`)).database_path).toBe('/var/db/x.db')
    expect(loadConfig(write(`${g}database_path: ":memory:"\n`)).database_path).toBe(':memory:')
  })
  it('explains a missing file once with path, uid and a docker hint', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'cfg-')), 'config.yaml')
    let err: unknown
    try {
      loadConfig(p)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(ConfigError)
    const m = (err as Error).message
    expect(m).toContain(p)
    expect(m).toMatch(/does not exist/)
    expect(m).toContain(`uid ${process.getuid?.()}`)
    expect(m).toContain('copy config.docker.example.yaml to')
    expect(m).toContain('Run with Docker')
    expect(m.split('\n').filter((l) => l.startsWith('cannot read'))).toHaveLength(1)
  })
  it.skipIf(process.getuid?.() === 0)('distinguishes an unreadable file', () => {
    const p = write('guilds: {}\n')
    chmodSync(p, 0o000)
    expect(() => loadConfig(p)).toThrow(/not readable/)
  })
  it('generates a minimal config from DISCORD_MCP_GUILD_ID when the file is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cfg-'))
    const cfg = loadConfig(join(dir, 'config.yaml'), { DISCORD_MCP_GUILD_ID: '123456789012345678' })
    expect(cfg.guilds['123456789012345678']?.max_tier).toBe('write')
    expect(cfg.http.host).toBe('0.0.0.0')
    expect(cfg.database_path).toBe(join(dir, 'discord-mcp.db'))
  })
  it('config errors carry exit code 78', () => {
    expect(EX_CONFIG).toBe(78)
    expect(() => loadConfig('/nonexistent/x.yaml')).toThrow(ConfigError)
    expect(() => loadConfig(write('a: [unclosed'))).toThrow(ConfigError)
  })
  it('checkWritableDir names directory and uid', () => {
    const dir = mkdtempSync(join(tmpdir(), 'w-'))
    expect(() => checkWritableDir(join(dir, 'x.db'))).not.toThrow()
    expect(() => checkWritableDir('/nonexistent-dir-zz/x.db')).toThrow(/(not writable|does not exist).*uid.*chown 1000:1000/s)
    expect(() => checkWritableDir(':memory:')).not.toThrow()
  })
})
