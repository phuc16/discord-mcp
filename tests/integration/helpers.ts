import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import type { Principal } from '../../src/contracts/index.js'
import type { FakeDiscordPort } from '../fakes/fake-discord-port.js'

export const GUILD_A = '100000000000000001'
export const GUILD_B = '100000000000000002'
export const GUILD_C = '100000000000000003'

export interface CallOutcome {
  isError: boolean
  body: Record<string, unknown>
  code: string | null
  details: Record<string, unknown>
  text: string
}

export const call = async (client: Client, name: string, args: Record<string, unknown>): Promise<CallOutcome> => {
  const r = (await client.callTool({ name, arguments: args })) as { isError?: boolean; content: { type: string; text: string }[] }
  const text = r.content[0]?.text ?? ''
  let body: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(text)
    body = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed }
  } catch {
    body = { raw: text }
  }
  const err = body.error as { code?: string; details?: Record<string, unknown> } | undefined
  return { isError: r.isError === true, body, code: err?.code ?? null, details: err?.details ?? {}, text }
}

const READ_PREFIXES = ['get', 'list', 'fetch', 'search']

export const mutatingCalls = (discord: FakeDiscordPort): string[] =>
  discord.calls.map((c) => c.method).filter((m) => !READ_PREFIXES.some((p) => m.startsWith(p)))

export const principals = {
  stdio: { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} },
  service: { kind: 'service', userId: null, userName: 'ci', guilds: {} },
  admin: { kind: 'user', userId: '11', userName: 'admin', guilds: { [GUILD_A]: '8', [GUILD_B]: '8', [GUILD_C]: '8' } },
  manageGuildOnly: { kind: 'user', userId: '12', userName: 'mg', guilds: { [GUILD_A]: '32', [GUILD_B]: '32', [GUILD_C]: '32' } },
  banAndManageGuild: { kind: 'user', userId: '13', userName: 'bm', guilds: { [GUILD_A]: '36', [GUILD_B]: '36', [GUILD_C]: '36' } },
  notInGuild: { kind: 'user', userId: '14', userName: 'out', guilds: {} },
} satisfies Record<string, Principal>
