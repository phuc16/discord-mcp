import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import type { Config, Logger } from '../../src/contracts/index.js'
import { ConfigSchema } from '../../src/contracts/index.js'
import { launch } from '../../src/server/index.js'
import { openStore } from '../../src/store/index.js'
import type { Store } from '../../src/store/index.js'
import { FakeDiscordPort } from '../fakes/fake-discord-port.js'
import { FakeGateway } from '../fakes/fake-gateway.js'

export const GUILD_A = '100000000000000001'

export const freePort = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })

export const sha256 = (v: string): string => createHash('sha256').update(v).digest('hex')

export interface StackOptions {
  http?: Record<string, unknown>
  config?: Record<string, unknown>
}

export interface Stack {
  base: string
  port: number
  store: Store
  discord: FakeDiscordPort
  gateway: FakeGateway
  config: Config
  logs: { level: string; obj: Record<string, unknown>; msg?: string }[]
  close(): Promise<void>
}

export const startStack = async (o: StackOptions = {}): Promise<Stack> => {
  const port = await freePort()
  const logs: Stack['logs'] = []
  const logger: Logger = {
    info: (obj, msg) => void logs.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => void logs.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => void logs.push({ level: 'error', obj, msg }),
    debug: (obj, msg) => void logs.push({ level: 'debug', obj, msg }),
  }
  const config = ConfigSchema.parse({
    guilds: { [GUILD_A]: { max_tier: 'destructive' } },
    ...o.config,
    http: { host: '127.0.0.1', port, ...o.http },
  })
  const store = openStore(':memory:')
  const discord = new FakeDiscordPort()
  discord.seedGuild(GUILD_A)
  const gateway = new FakeGateway()
  const handle = await launch(
    {
      config,
      env: { PUBLIC_BASE_URL: `http://127.0.0.1:${port}`, DISCORD_CLIENT_ID: 'id', DISCORD_CLIENT_SECRET: 'secret' },
      logger,
      store,
      discord,
      gateway,
      discordOAuth: {
        exchangeCode: async () => ({ accessToken: 'x' }),
        fetchUser: async () => ({ id: '1', username: 'u' }),
        fetchUserGuilds: async () => [],
      },
    },
    { http: true },
  )
  return { base: `http://127.0.0.1:${port}`, port, store, discord, gateway, config, logs, close: () => handle.close() }
}

export const rpc = (token: string, body: unknown, extra: Record<string, string> = {}): RequestInit => ({
  method: 'POST',
  headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...extra },
  body: typeof body === 'string' ? body : JSON.stringify(body),
})

export const initializeBody = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'qa', version: '0' } },
}

export const registerBody = (i: number, redirect = 'http://127.0.0.1:9/cb'): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ redirect_uris: [redirect], token_endpoint_auth_method: 'none', client_name: `client-${i}` }),
})
