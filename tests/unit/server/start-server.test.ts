import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FakeDiscordPort } from '../../fakes/fake-discord-port.js'
import { FakeGateway } from '../../fakes/fake-gateway.js'

const gateway = new FakeGateway()
vi.mock('../../../src/discord/index.js', () => ({
  createDiscordPort: () => new FakeDiscordPort(),
  createGateway: () => gateway,
  createDiscordOAuthPort: () => ({
    exchangeCode: async () => ({ accessToken: 'x' }),
    fetchUser: async () => ({ id: '1', username: 'u' }),
    fetchUserGuilds: async () => [],
  }),
}))
vi.mock('../../../src/server/stdio.js', () => ({ startStdio: async () => ({ close: async () => undefined }), STDIO_PRINCIPAL: {} }))

const configPath = (port: number): string => {
  const dir = mkdtempSync(join(tmpdir(), 'ss-'))
  const p = join(dir, 'c.yaml')
  writeFileSync(p, `guilds:\n  "100000000000000001":\n    max_tier: read\nhttp:\n  host: 127.0.0.1\n  port: ${port}\ndatabase_path: ":memory:"\n`)
  return p
}

const freePort = (): Promise<number> =>
  new Promise((resolve) => {
    const s = createServer()
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })

const handlers = new Map<string, () => void>()

afterEach(() => {
  vi.restoreAllMocks()
  handlers.clear()
  for (const k of ['DISCORD_BOT_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUBLIC_BASE_URL']) delete process.env[k]
})

const capture = () => {
  vi.spyOn(process, 'once').mockImplementation(((sig: string, fn: () => void) => {
    handlers.set(sig, fn)
    return process
  }) as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  return vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
}

describe('startServer', () => {
  it('fails without a bot token', async () => {
    const { startServer } = await import('../../../src/server/index.js')
    await expect(startServer({ configPath: configPath(1), http: false })).rejects.toThrow(/DISCORD_BOT_TOKEN/)
  })
  it('fails in http mode without oauth env', async () => {
    process.env.DISCORD_BOT_TOKEN = 't'
    const { startServer } = await import('../../../src/server/index.js')
    await expect(startServer({ configPath: configPath(1), http: true })).rejects.toThrow(/DISCORD_CLIENT_ID/)
  })
  it('starts stdio mode and shuts down on SIGTERM', async () => {
    process.env.DISCORD_BOT_TOKEN = 't'
    const exit = capture()
    const { startServer } = await import('../../../src/server/index.js')
    await startServer({ configPath: configPath(1), http: false })
    expect(gateway.status()).toBe('ready')
    handlers.get('SIGTERM')!()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(gateway.status()).toBe('disconnected')
  })
  it('starts http mode and shuts down on SIGINT, ignoring repeated signals', async () => {
    Object.assign(process.env, { DISCORD_BOT_TOKEN: 't', DISCORD_CLIENT_ID: '1', DISCORD_CLIENT_SECRET: 's', PUBLIC_BASE_URL: 'http://127.0.0.1' })
    const exit = capture()
    const { startServer } = await import('../../../src/server/index.js')
    await startServer({ configPath: configPath(await freePort()), http: true })
    handlers.get('SIGINT')!()
    handlers.get('SIGINT')!()
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0))
    expect(exit).toHaveBeenCalledTimes(1)
  })
})
