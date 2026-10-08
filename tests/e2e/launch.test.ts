import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { describe, expect, it } from 'vitest'
import { ConfigSchema } from '../../src/contracts/index.js'
import type { Logger } from '../../src/contracts/index.js'
import { launch } from '../../src/server/index.js'
import { openStore } from '../../src/store/index.js'
import { FakeDiscordPort } from '../fakes/fake-discord-port.js'
import { FakeGateway } from '../fakes/fake-gateway.js'

const GUILD_A = '100000000000000001'
const TOKEN = 'launch-service-token'

const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })

const silent: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined }

describe('launch (http)', () => {
  it('starts gateway and http, serves healthz and mcp, and closes everything', async () => {
    const port = await freePort()
    const config = ConfigSchema.parse({
      guilds: { [GUILD_A]: { max_tier: 'destructive' } },
      http: { host: '127.0.0.1', port, service_tokens: [{ name: 'ci', sha256: createHash('sha256').update(TOKEN).digest('hex') }] },
    })
    const store = openStore(':memory:')
    const discord = new FakeDiscordPort()
    discord.seedGuild(GUILD_A)
    const gateway = new FakeGateway()
    const handle = await launch(
      {
        config,
        env: { PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, DISCORD_CLIENT_ID: 'id' },
        logger: silent,
        store,
        discord,
        gateway,
        discordOAuth: { exchangeCode: async () => ({ accessToken: 'x' }), fetchUser: async () => ({ id: '1', username: 'u' }), fetchUserGuilds: async () => [] },
      },
      { http: true },
    )
    expect(handle.port).toBe(port)
    expect(gateway.status()).toBe('ready')

    const health = await fetch(`http://127.0.0.1:${port}/healthz`)
    expect(await health.json()).toMatchObject({ status: 'ok', gateway: 'ready', db: 'ok' })

    const init = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'qa', version: '0' } },
      }),
    })
    expect(init.status).toBe(200)

    await handle.close()
    expect(gateway.status()).toBe('disconnected')
    await expect(fetch(`http://127.0.0.1:${port}/healthz`)).rejects.toThrow()
    expect(() => store.audit.query({ limit: 1 })).toThrow()
  })

  it('refuses to start http mode without a discord oauth port', async () => {
    const config = ConfigSchema.parse({ guilds: { [GUILD_A]: { max_tier: 'read' } } })
    const store = openStore(':memory:')
    await expect(
      launch({ config, env: {}, logger: silent, store, discord: new FakeDiscordPort(), gateway: new FakeGateway() }, { http: true }),
    ).rejects.toThrow()
    store.close()
  })
})
