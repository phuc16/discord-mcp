import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
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
})
