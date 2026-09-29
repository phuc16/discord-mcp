import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadDotEnv } from '../../../src/cli/env.js'

describe('loadDotEnv', () => {
  it('returns null when the file is absent', () => {
    expect(loadDotEnv(join(tmpdir(), 'no-such-dir', '.env'))).toBeNull()
  })
  it('loads a valid file', () => {
    const p = join(mkdtempSync(join(tmpdir(), 'env-')), '.env')
    writeFileSync(p, 'DISCORD_MCP_ENV_TEST=1\n')
    expect(loadDotEnv(p)).toBeNull()
    expect(process.env.DISCORD_MCP_ENV_TEST).toBe('1')
    delete process.env.DISCORD_MCP_ENV_TEST
  })
  it('reports load errors instead of throwing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'env-'))
    expect(loadDotEnv(dir)).toMatch(/cannot load/)
  })
})
