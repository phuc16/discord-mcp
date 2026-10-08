import Database from 'better-sqlite3'
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadConfig } from '../../src/cli/config-loader.js'
import { ConfigSchema } from '../../src/contracts/index.js'
import type { Logger } from '../../src/contracts/index.js'
import { launch } from '../../src/server/index.js'
import { openStore } from '../../src/store/index.js'
import { FakeDiscordPort } from '../fakes/fake-discord-port.js'
import { FakeGateway } from '../fakes/fake-gateway.js'

const GUILD_A = '100000000000000001'
const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }

const scratch: string[] = []
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'discord-mcp-qa-'))
  scratch.push(d)
  return d
}
afterAll(() => {
  for (const d of scratch) rmSync(d, { recursive: true, force: true })
})

describe('database_path', () => {
  it('resolves relative to the config file directory, not the working directory', () => {
    const dir = tmp()
    writeFileSync(join(dir, 'config.yaml'), `guilds:\n  "${GUILD_A}":\n    max_tier: read\ndatabase_path: ./data/mcp.db\n`)
    const config = loadConfig(join(dir, 'config.yaml'))
    expect(config.database_path).toBe(resolve(dir, 'data/mcp.db'))
    expect(config.database_path.startsWith(process.cwd())).toBe(false)
  })

  it('an absolute database_path is kept as is', () => {
    const dir = tmp()
    const abs = join(dir, 'abs.db')
    writeFileSync(join(dir, 'config.yaml'), `guilds:\n  "${GUILD_A}":\n    max_tier: read\ndatabase_path: ${abs}\n`)
    expect(loadConfig(join(dir, 'config.yaml')).database_path).toBe(abs)
  })
})

describe('single instance lock', () => {
  it('a second open of the same database in one process is refused with a clear message', () => {
    const file = join(tmp(), 'one.db')
    const first = openStore(file)
    expect(() => openStore(file)).toThrow(/already in use/)
    expect(() => openStore(file)).toThrow(/database_path/)
    first.close()
    const again = openStore(file)
    again.close()
  })

  it('a lock held by another live process refuses to start and names the pid', async () => {
    const file = join(tmp(), 'two.db')
    const other = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
    try {
      writeFileSync(`${file}.lock`, String(other.pid))
      expect(() => openStore(file)).toThrow(new RegExp(`already in use by process ${other.pid}`))
    } finally {
      other.kill('SIGKILL')
      await new Promise((r) => other.once('exit', r))
    }
  })

  it('a stale lock from a dead process is reclaimed', async () => {
    const file = join(tmp(), 'three.db')
    const dead = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
    await new Promise((r) => dead.once('exit', r))
    writeFileSync(`${file}.lock`, String(dead.pid))
    const store = openStore(file)
    store.close()
  })

  it('close releases the lock file', () => {
    const file = join(tmp(), 'four.db')
    openStore(file).close()
    const second = openStore(file)
    second.close()
  })
})

describe('schema versioning', () => {
  it('refuses a database written by a newer build and leaves it untouched', () => {
    const file = join(tmp(), 'future.db')
    openStore(file).close()
    const raw = new Database(file)
    raw.prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'").run()
    raw.close()
    expect(() => openStore(file)).toThrow(/newer than this build/)
    expect(() => openStore(file)).toThrow(/newer than this build/)
    const after = new Database(file)
    expect((after.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string }).value).toBe('999')
    after.close()
  })
})

describe('stdio lifecycle', () => {
  it('ends the session when stdin ends', async () => {
    const config = ConfigSchema.parse({ guilds: { [GUILD_A]: { max_tier: 'read' } } })
    const store = openStore(':memory:')
    const discord = new FakeDiscordPort()
    discord.seedGuild(GUILD_A)
    let exits = 0
    const handle = await launch({ config, env: {}, logger: silent, store, discord, gateway: new FakeGateway() }, { http: false, onExit: () => void (exits += 1) })
    process.stdin.emit('end')
    process.stdin.emit('close')
    expect(exits).toBe(1)
    await handle.close()
  })
})

describe('cli startup', () => {
  const out = resolve('node_modules/.cache/discord-mcp-qa-dist')

  beforeAll(() => {
    mkdirSync(out, { recursive: true })
    execFileSync('pnpm', ['exec', 'tsup', '--out-dir', out, '--no-clean'], { stdio: 'pipe' })
  }, 120_000)

  const runCli = (cwd: string, args: string[]) =>
    spawnSync(process.execPath, [join(out, 'cli/main.js'), ...args], { cwd, encoding: 'utf8', timeout: 20_000, env: { PATH: process.env.PATH ?? '' } })

  it('an unreadable .env is reported cleanly, without a stack trace', () => {
    const dir = tmp()
    mkdirSync(join(dir, '.env'))
    const r = runCli(dir, ['check', '--config', join(dir, 'missing.yaml')])
    expect(r.status).toBe(78)
    expect(r.stderr.trim().length).toBeGreaterThan(0)
    expect(r.stderr).not.toMatch(/\n\s+at |node:internal|Error: /)
  })
})
