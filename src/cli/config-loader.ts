import { readFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'
import { parse } from 'yaml'
import { ConfigSchema } from '../contracts/index.js'
import { ConfigError, currentUid } from './errors.js'
import type { Config } from '../contracts/index.js'

const missingFile = (path: string, code: string | undefined): ConfigError => {
  const abs = resolve(path)
  const reason = code === 'ENOENT' ? 'does not exist' : code === 'EACCES' || code === 'EPERM' ? 'is not readable by the current user' : `cannot be read (${code ?? 'error'})`
  return new ConfigError(
    `cannot read config file ${abs}: it ${reason} (uid ${currentUid()}).\nHint: copy config.docker.example.yaml to ${dirname(abs)}/config.yaml and edit the guild id (see README: Run with Docker).`,
  )
}

const generated = (path: string, env: NodeJS.ProcessEnv): unknown => ({
  guilds: { [env.DISCORD_MCP_GUILD_ID ?? '']: { max_tier: env.DISCORD_MCP_MAX_TIER ?? 'write' } },
  http: { host: '0.0.0.0' },
  database_path: resolve(dirname(resolve(path)), 'discord-mcp.db'),
})

export const loadConfig = (path: string, env: NodeJS.ProcessEnv = {}): Config => {
  let text: string | undefined
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    if (!(code === 'ENOENT' && env.DISCORD_MCP_GUILD_ID)) throw missingFile(path, code)
  }
  let raw: unknown
  try {
    raw = text === undefined ? generated(path, env) : parse(text)
  } catch (err) {
    throw new ConfigError(`invalid YAML in ${path}: ${(err as Error).message}`)
  }
  const result = ConfigSchema.safeParse(raw ?? {})
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new ConfigError(`invalid config ${path}:\n${lines.join('\n')}`)
  }
  const dbPath = result.data.database_path
  if (dbPath === ':memory:' || isAbsolute(dbPath)) return result.data
  return { ...result.data, database_path: resolve(dirname(resolve(path)), dbPath) }
}
