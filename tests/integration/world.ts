import { z } from 'zod'
import type { AnyToolDef } from '../../src/contracts/index.js'
import { stdioPrincipal, buildHarness } from '../fakes/harness.js'
import type { Harness } from '../fakes/harness.js'
import { GUILD_A, GUILD_B } from './helpers.js'

export const RESOURCE_KEYS = [
  'channel_id',
  'system_channel_id',
  'parent_id',
  'thread_id',
  'message_id',
  'webhook_id',
  'code',
  'event_id',
  'emoji_id',
  'sticker_id',
  'role_id',
  'rule_id',
]

export type Json = { type?: string; enum?: unknown[]; properties?: Record<string, Json>; required?: string[]; items?: Json; anyOf?: Json[]; oneOf?: Json[]; minimum?: number; maximum?: number; minLength?: number; maxLength?: number; minItems?: number; pattern?: string; format?: string; const?: unknown; default?: unknown }

export const synth = (s: Json): unknown => {
  if (s.const !== undefined) return s.const
  if (s.enum) return s.enum[0]
  const alt = s.anyOf ?? s.oneOf
  if (alt?.length) return synth(alt[0]!)
  switch (s.type) {
    case 'string':
      if (s.pattern?.includes('\\d{17,20}')) return '700000000000000001'
      if (s.pattern === '^\\d+$') return '0'
      if (s.format === 'date-time') return '2030-01-01T00:00:00Z'
      return 'x'.repeat(Math.max(1, s.minLength ?? 1))
    case 'integer':
    case 'number': {
      const min = s.minimum ?? 1
      return Math.min(Math.max(min, 1), s.maximum ?? Number.MAX_SAFE_INTEGER)
    }
    case 'boolean':
      return false
    case 'array':
      return Array.from({ length: s.minItems ?? 0 }, () => synth(s.items ?? {}))
    case 'object': {
      const out: Record<string, unknown> = {}
      for (const k of s.required ?? []) out[k] = synth(s.properties?.[k] ?? {})
      return out
    }
    default:
      return 'x'
  }
}

export const EXTRAS: Record<string, Record<string, unknown>> = {
  messages_send: { content: 'x' },
  messages_edit: { content: 'x' },
  messages_purge: { before: '9223372036854775807' },
  rules_create_destructive: {
    trigger: { event: 'member_join', filter: {} },
    actions: [{ tool: 'mod_kick', input_template: { user_id: '{{event.data.user_id}}' } }],
    allow_destructive: true,
  },
  rules_update_destructive: { allow_destructive: true },
  rules_test: { sample_event: { id: 1, guildId: GUILD_A, type: 'member_join', at: '2030-01-01T00:00:00Z', data: {} } },
}


export interface World {
  harness: Harness
  foreign: Record<string, string>
  own: Record<string, string>
  memberA: string
  ruleId: string
}

export const buildWorld = async (): Promise<World> => {
  const harness = await buildHarness({ config: { safety: { allow_token_confirm: true }, guilds: { [GUILD_A]: { max_tier: 'destructive' } } } })
  const d = harness.discord
  const foreign: Record<string, string> = {}
  const own: Record<string, string> = {}
  d.seedGuild(GUILD_A, { members: 1 })
  d.seedGuild(GUILD_B, { members: 1 })
  const memberA = [...d.members.get(GUILD_A)!.keys()][0]!
  const seed = async (guildId: string, into: Record<string, string>, label: string): Promise<void> => {
    const ch = await d.createChannel(guildId, { name: label, type: 0 })
    into.channel_id = ch.id
    into.system_channel_id = ch.id
    into.parent_id = ch.id
    into.thread_id = (await d.createThread(ch.id, { name: 't' })).id
    into.message_id = (await d.sendMessage(ch.id, { content: label })).id
    into.webhook_id = (await d.createWebhook(ch.id, { name: 'hook' })).id
    into.code = (await d.createInvite(ch.id, {})).code as string
    into.event_id = (await d.createScheduledEvent(guildId, { name: 'e' })).id
    into.emoji_id = (await d.createEmoji(guildId, { name: 'e', image: 'data:image/png;base64,AA==' })).id
    into.sticker_id = (await d.createSticker(guildId, { name: 'sticker', description: 'sticker', tags: 't', file: 'AA==' })).id
    into.role_id = (await d.createRole(guildId, { name: 'r' })).id
    into.rule_id = (await d.createAutomodRule(guildId, { name: 'am', event_type: 1, trigger_type: 1, actions: [{ type: 1 }] })).id
  }
  await seed(GUILD_B, foreign, 'b')
  await seed(GUILD_A, own, 'a')
  const rule = await harness.rules.create(stdioPrincipal, {
    guild_id: GUILD_A,
    trigger: { event: 'member_join', filter: {} },
    conditions: [],
    actions: [{ tool: 'roles_assign', input_template: { user_id: '{{event.data.user_id}}', role_id: own.role_id } }],
    cooldown_sec: 0,
    allow_destructive: false,
    enabled: true,
  })
  d.calls.length = 0
  return { harness, foreign, own, memberA, ruleId: rule.id }
}

export const argsFor = (tool: AnyToolDef, world: World, foreignKey?: string): Record<string, unknown> => {
  const base = synth(z.toJSONSchema(tool.input) as Json) as Record<string, unknown>
  const args: Record<string, unknown> = { ...base, guild_id: GUILD_A }
  if ('user_id' in base) args.user_id = world.memberA
  if ('user_ids' in base) args.user_ids = [world.memberA]
  for (const k of RESOURCE_KEYS) if (k in args) args[k] = world.own[k]
  if (foreignKey) {
    args[foreignKey] = world.foreign[foreignKey]
    if (foreignKey === 'rule_id' && tool.name.startsWith('rules_')) args.rule_id = 'rule-in-b'
  }
  if (!foreignKey && tool.name.startsWith('rules_') && 'rule_id' in args) args.rule_id = world.ruleId
  Object.assign(args, EXTRAS[tool.name])
  return args
}
