import type { DiscordPort } from '../contracts/index.js'
import { openStore } from '../store/index.js'
import { loadConfig } from './config-loader.js'

export interface CheckOptions {
  configPath: string
  http: boolean
  online: boolean
  env?: NodeJS.ProcessEnv
  discord?: () => DiscordPort
}

export interface CheckResult {
  ok: boolean
  problems: string[]
}

const STDIO_ENV = ['DISCORD_BOT_TOKEN']
const HTTP_ENV = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'PUBLIC_BASE_URL']

export const runCheck = async (opts: CheckOptions): Promise<CheckResult> => {
  const env = opts.env ?? process.env
  const problems: string[] = []
  let guildIds: string[] = []
  try {
    guildIds = Object.keys(loadConfig(opts.configPath).guilds)
  } catch (err) {
    problems.push((err as Error).message)
  }
  for (const name of opts.http ? [...STDIO_ENV, ...HTTP_ENV] : STDIO_ENV) {
    if (!env[name]) problems.push(`missing env var ${name}`)
  }
  try {
    openStore(':memory:').close()
  } catch (err) {
    problems.push(`store cannot open: ${(err as Error).message}`)
  }
  if (opts.online && opts.discord && problems.length === 0) {
    try {
      const present = new Set(await opts.discord().listBotGuildIds())
      for (const id of guildIds) if (!present.has(id)) problems.push(`bot is not a member of configured guild ${id}`)
    } catch (err) {
      problems.push(`discord check failed: ${(err as Error).message}`)
    }
  }
  return { ok: problems.length === 0, problems }
}
