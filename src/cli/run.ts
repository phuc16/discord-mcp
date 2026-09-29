import { parseArgs } from 'node:util'
import { runCheck } from './check.js'
import { buildInviteUrl } from './invite-url.js'

const USAGE = `usage:
  discord-mcp [--config <path>] [--http]
  discord-mcp --check [--config <path>] [--http] [--online]
  discord-mcp invite-url --client-id <id> --permissions <read|moderator|manager|admin|bits>
`

export const run = async (argv: string[], env: NodeJS.ProcessEnv = process.env): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      config: { type: 'string' },
      http: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
      online: { type: 'boolean', default: false },
      'client-id': { type: 'string' },
      permissions: { type: 'string', default: 'manager' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  if (values.help) {
    process.stdout.write(USAGE)
    return 0
  }
  if (positionals[0] === 'invite-url') {
    const clientId = values['client-id'] ?? env.DISCORD_CLIENT_ID
    if (!clientId) {
      process.stderr.write('missing --client-id (or DISCORD_CLIENT_ID)\n')
      return 1
    }
    const raw = values.permissions
    try {
      process.stdout.write(`${buildInviteUrl(clientId, /^\d+$/.test(raw) ? BigInt(raw) : raw)}\n`)
      return 0
    } catch (err) {
      process.stderr.write(`${(err as Error).message}\n`)
      return 1
    }
  }
  if (positionals.length > 0) {
    process.stderr.write(USAGE)
    return 1
  }
  if (values.check) {
    const { createDiscordPort } = await import('../discord/index.js')
    const result = await runCheck({
      configPath: values.config ?? env.DISCORD_MCP_CONFIG ?? 'config.yaml',
      http: values.http,
      online: values.online,
      env,
      discord: () => createDiscordPort({ botToken: env.DISCORD_BOT_TOKEN ?? '' }),
    })
    if (result.ok) process.stdout.write('ok\n')
    else process.stderr.write(`${result.problems.map((p) => `- ${p}`).join('\n')}\n`)
    return result.ok ? 0 : 1
  }
  const { startServer } = await import('../server/index.js')
  await startServer({ configPath: values.config ?? env.DISCORD_MCP_CONFIG ?? 'config.yaml', http: values.http })
  return 0
}
