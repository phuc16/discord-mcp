import type { RequestHandler, Router } from 'express'
import type { Config, DiscordOAuthPort, DiscordPort, GatewayPort, Logger, Services } from '../contracts/index.js'
import { createAuthProvider, createAuthRouter, createBearerMiddleware, createPermissionRefresher } from '../auth/index.js'
import { createEventsService } from '../events/index.js'
import type { EventsService } from '../events/index.js'
import { createRulesService } from '../rules/index.js'
import type { RulesService } from '../rules/index.js'
import { PolicyEngine, createAuditPort, createAuditWriter, createBulkLimiter, createConfirmService, runTool } from '../safety/index.js'
import type { PipelineDeps } from '../safety/index.js'
import type { Store } from '../store/index.js'
import { allTools } from '../tools/index.js'
import type { ServerDeps } from './mcp.js'
import { buildToolRegistry } from './registry.js'

export interface RuntimeInput {
  config: Config
  env: NodeJS.ProcessEnv
  logger: Logger
  store: Store
  discord: DiscordPort
  gateway: GatewayPort
  discordOAuth?: DiscordOAuthPort
}

export interface HttpAuth {
  bearer: RequestHandler
  router: Router
  start(): void
  stop(): void
}

export interface Runtime {
  deps: ServerDeps
  events: EventsService
  rules: RulesService
  http?: HttpAuth
  start(): Promise<void>
  stop(): Promise<void>
}

const STORE_PRUNE_INTERVAL_MS = 10 * 60_000

export const buildRuntime = (input: RuntimeInput, opts: { http: boolean }): Runtime => {
  const { config, env, logger, store, discord, gateway } = input
  const policy = new PolicyEngine(config)
  const registry = buildToolRegistry(allTools, config.tools.deny)

  const events = createEventsService({
    store,
    gateway,
    config,
    guildIds: Object.keys(config.guilds),
    canRead: (p, g) => policy.canRead(p, g),
  })

  const pipeline: PipelineDeps = {
    policy,
    confirm: createConfirmService({ store }),
    audit: createAuditWriter({ store, logger }),
    limiter: createBulkLimiter({ perMinute: config.rate_limits.bulk_per_minute }),
    allowTokenConfirm: config.safety.allow_token_confirm,
  }

  const servicesRef: { current?: Services } = {}
  const rules = createRulesService({
    store,
    policy,
    pipeline,
    subscribe: (cb) => events.subscribe(cb),
    toolByName: (name) => registry.get(name),
    discord,
    services: () => servicesRef.current as Services,
    logger,
    limits: { maxPerGuild: config.rules.max_per_guild, minCooldownSec: config.rules.min_cooldown_sec },
  })
  const services: Services = { events, rules, audit: createAuditPort({ store, policy }), policy }
  servicesRef.current = services

  const deps: ServerDeps = {
    registry,
    discord,
    services,
    logger,
    recentEvents: (guildId, limit) => events.recent(guildId, limit),
    eventFeed: { subscribe: (cb) => events.subscribe(cb) },
    runTool: (def, rawInput, principal, o) => runTool(pipeline, def, rawInput, principal, { discord, services, logger, ...o }),
  }

  let http: HttpAuth | undefined
  if (opts.http) {
    const publicBaseUrl = env.PUBLIC_BASE_URL ?? ''
    const discordOAuth = input.discordOAuth
    if (!discordOAuth) throw new Error('discord oauth port required for http mode')
    const refresher = createPermissionRefresher({
      store,
      discord,
      subscribe: (cb) => events.subscribe(cb),
      onDemoted: (userId, guildId, reason) => rules.disableForOwner(userId, guildId, reason),
    })
    const provider = createAuthProvider({
      store,
      discordOAuth,
      discord,
      policy,
      config: { publicBaseUrl, discordClientId: env.DISCORD_CLIENT_ID ?? '' },
      beforeIssue: (session) => refresher.refreshSession(session),
    })
    http = {
      bearer: createBearerMiddleware({ store, serviceTokens: config.http.service_tokens, publicBaseUrl }),
      router: createAuthRouter(provider, { publicBaseUrl }),
      start: () => refresher.start(),
      stop: () => refresher.stop(),
    }
  }

  let pruneTimer: NodeJS.Timeout | undefined

  return {
    deps,
    events,
    rules,
    http,
    async start() {
      store.pruneExpired(Date.now())
      pruneTimer = setInterval(() => {
        try {
          store.pruneExpired(Date.now())
        } catch (err) {
          logger.warn({ error: err instanceof Error ? err.name : 'unknown' }, 'store prune failed')
        }
      }, STORE_PRUNE_INTERVAL_MS)
      pruneTimer.unref()
      await gateway.start()
      events.start()
      rules.start()
      http?.start()
    },
    async stop() {
      if (pruneTimer) clearInterval(pruneTimer)
      pruneTimer = undefined
      http?.stop()
      rules.stop()
      events.stop()
      await gateway.stop()
    },
  }
}
