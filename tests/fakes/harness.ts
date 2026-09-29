import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { ConfigSchema } from '../../src/contracts/index.js'
import type { Config, Logger, Principal, Services } from '../../src/contracts/index.js'
import { createEventsService } from '../../src/events/index.js'
import type { EventsService } from '../../src/events/index.js'
import {
  PolicyEngine,
  createAuditPort,
  createAuditWriter,
  createBulkLimiter,
  createConfirmService,
  runTool,
} from '../../src/safety/index.js'
import { createRulesService } from '../../src/rules/index.js'
import type { RulesService } from '../../src/rules/index.js'
import { buildToolRegistry } from '../../src/server/registry.js'
import { createMcpServer } from '../../src/server/mcp.js'
import { openStore } from '../../src/store/index.js'
import type { Store } from '../../src/store/index.js'
import { allTools } from '../../src/tools/index.js'
import { FakeDiscordPort } from './fake-discord-port.js'
import { FakeGateway } from './fake-gateway.js'

export const DEFAULT_GUILD = '100000000000000001'

export const stdioPrincipal: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }

export interface Clock {
  now(): number
  advance(ms: number): void
}

export interface ConnectOptions {
  elicit?: 'accept' | 'decline' | 'error'
  onElicit?: (message: string) => void
}

export interface LogLine {
  level: string
  obj: Record<string, unknown>
  msg?: string
}

export interface Harness {
  client: Client
  server: McpServer
  discord: FakeDiscordPort
  gateway: FakeGateway
  store: Store
  services: Services
  events: EventsService
  rules: RulesService
  config: Config
  clock: Clock
  logs: LogLine[]
  close(): Promise<void>
  asPrincipal(p: Principal, opts?: ConnectOptions): Promise<Client>
}

export const buildHarness = async (o: { config?: Partial<Config> } = {}): Promise<Harness> => {
  const config = ConfigSchema.parse({ guilds: { [DEFAULT_GUILD]: { max_tier: 'destructive' } }, ...o.config })
  let time = Date.parse('2026-09-29T12:00:00.000Z')
  const clock: Clock = {
    now: () => time,
    advance: (ms) => {
      time += ms
    },
  }
  const logs: LogLine[] = []
  const logger: Logger = {
    info: (obj, msg) => void logs.push({ level: 'info', obj, msg }),
    warn: (obj, msg) => void logs.push({ level: 'warn', obj, msg }),
    error: (obj, msg) => void logs.push({ level: 'error', obj, msg }),
    debug: (obj, msg) => void logs.push({ level: 'debug', obj, msg }),
  }

  const discord = new FakeDiscordPort()
  const gateway = new FakeGateway()
  const store = openStore(':memory:')
  const policy = new PolicyEngine(config)
  const confirm = createConfirmService({ store, now: clock.now })
  const audit = createAuditWriter({ store, logger })
  const limiter = createBulkLimiter({ perMinute: config.rate_limits.bulk_per_minute, now: clock.now })
  const events = createEventsService({
    store,
    gateway,
    config,
    guildIds: Object.keys(config.guilds),
    canRead: (p, g) => policy.canRead(p, g),
    now: clock.now,
  })
  events.start()
  const registry = buildToolRegistry(allTools, config.tools.deny)
  const pipeline = { policy, confirm, audit, limiter, allowTokenConfirm: config.safety.allow_token_confirm, now: clock.now }
  const holder: { services?: Services } = {}
  const rules = createRulesService({
    store,
    policy,
    pipeline,
    subscribe: (cb) => events.subscribe(cb),
    toolByName: (name) => registry.get(name),
    discord,
    services: () => holder.services!,
    logger,
    now: clock.now,
  })
  const services: Services = { events, rules, audit: createAuditPort({ store, policy }), policy }
  holder.services = services
  rules.start()

  const open: { client: Client; server: McpServer }[] = []
  const connect = async (principal: Principal, copts: ConnectOptions = {}): Promise<{ client: Client; server: McpServer }> => {
    const server = createMcpServer(
      {
        registry,
        discord,
        services,
        logger,
        eventFeed: events,
        recentEvents: (guildId, limit) => events.recent(guildId, limit),
        runTool: (def, raw, p, opts) => runTool(pipeline, def, raw, p, { ...opts, discord, services, logger }),
      },
      () => principal,
    )
    const client = new Client({ name: 'qa', version: '0.0.0' }, copts.elicit ? { capabilities: { elicitation: {} } } : {})
    if (copts.elicit) {
      const action = copts.elicit
      client.setRequestHandler(ElicitRequestSchema, async (request) => {
        copts.onElicit?.(request.params.message)
        if (action === 'error') throw new Error('elicitation unavailable')
        return { action }
      })
    }
    const [a, b] = InMemoryTransport.createLinkedPair()
    await Promise.all([server.connect(a), client.connect(b)])
    const pair = { client, server }
    open.push(pair)
    return pair
  }

  const main = await connect(stdioPrincipal)
  return {
    client: main.client,
    server: main.server,
    discord,
    gateway,
    store,
    services,
    events,
    rules,
    config,
    clock,
    logs,
    asPrincipal: async (p, copts) => (await connect(p, copts)).client,
    close: async () => {
      for (const { client, server } of open) {
        await client.close()
        await server.close()
      }
      rules.stop()
      events.stop()
      store.close()
    },
  }
}
