import { createDiscordOAuthPort, createDiscordPort, createGateway } from '../discord/index.js'
import { createLogger } from '../cli/logger.js'
import { loadConfig } from '../cli/config-loader.js'
import { ConfigError, checkWritableDir } from '../cli/errors.js'
import { openStore } from '../store/index.js'
import { startHttp } from './http.js'
import type { HttpHandle } from './http.js'
import { startStdio } from './stdio.js'
import { buildRuntime } from './wiring.js'
import type { RuntimeInput } from './wiring.js'

export { buildToolRegistry } from './registry.js'
export { createMcpServer } from './mcp.js'
export type { ServerDeps } from './mcp.js'
export { startHttp } from './http.js'
export { startStdio } from './stdio.js'

const dbHealth = (store: RuntimeInput['store']): string => {
  try {
    store.ping()
    return 'ok'
  } catch {
    return 'error'
  }
}

export const launch = async (input: RuntimeInput, opts: { http: boolean; onExit?: () => void }): Promise<{ close(): Promise<void>; port?: number }> => {
  const runtime = buildRuntime(input, opts)
  let httpHandle: HttpHandle | undefined
  let stdio: { close(): Promise<void> } | undefined
  try {
    await runtime.start()
    if (opts.http && runtime.http) {
      httpHandle = await startHttp({
        deps: runtime.deps,
        host: input.config.http.host,
        port: input.config.http.port,
        bearer: runtime.http.bearer,
        authRouter: runtime.http.router,
        maxSessionsPerPrincipal: input.config.http.max_sessions_per_principal,
        trustProxy: input.config.http.trust_proxy,
        health: () => ({ gateway: input.gateway.status(), db: dbHealth(input.store) }),
      })
    } else {
      stdio = await startStdio(runtime.deps, { onEnd: opts.onExit })
    }
  } catch (err) {
    await runtime.stop().catch(() => undefined)
    input.store.close()
    throw err
  }
  return {
    port: httpHandle?.port,
    close: async () => {
      await httpHandle?.close()
      await stdio?.close()
      await runtime.stop()
      input.store.close()
    },
  }
}

const requireEnv = (env: NodeJS.ProcessEnv, name: string): string => {
  const value = env[name]
  if (!value) throw new ConfigError(`missing env var ${name}`)
  return value
}

export const startServer = async (opts: { configPath: string; http: boolean }): Promise<void> => {
  const env = process.env
  const config = loadConfig(opts.configPath, env)
  const logger = createLogger({ level: env.LOG_LEVEL })
  const botToken = requireEnv(env, 'DISCORD_BOT_TOKEN')
  const clientId = opts.http ? requireEnv(env, 'DISCORD_CLIENT_ID') : ''
  const clientSecret = opts.http ? requireEnv(env, 'DISCORD_CLIENT_SECRET') : ''
  if (opts.http) requireEnv(env, 'PUBLIC_BASE_URL')
  checkWritableDir(config.database_path)
  const store = openStore(config.database_path)
  const input: RuntimeInput = {
    config,
    env,
    logger,
    store,
    discord: createDiscordPort({ botToken }),
    gateway: createGateway({ botToken, messageContent: config.message_content_intent }),
    discordOAuth: opts.http ? createDiscordOAuthPort({ clientId, clientSecret }) : undefined,
  }
  let closing = false
  const running: { handle?: Awaited<ReturnType<typeof launch>> } = {}
  const shutdown = (): void => {
    if (closing) return
    closing = true
    const closed = running.handle ? running.handle.close() : Promise.resolve()
    closed.then(
      () => process.exit(0),
      () => process.exit(1),
    )
  }
  process.on('unhandledRejection', (reason) => {
    logger.error({ error: reason instanceof Error ? reason.name : 'unknown' }, 'unhandled promise rejection')
  })
  running.handle = await launch(input, { http: opts.http, onExit: shutdown })
  logger.info({ method: 'startup', path: opts.http ? '/mcp' : 'stdio', status: 'listening' }, 'discord-mcp started')
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.once('SIGHUP', shutdown)
}
