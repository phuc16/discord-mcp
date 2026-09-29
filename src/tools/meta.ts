import { z } from 'zod'
import {
  EVENT_TYPES,
  McpToolError,
  RuleInputSchema,
  type AnyToolDef,
  type AuditQuery,
  type ToolContext,
} from '../contracts/index.js'
import { defineTool, defined, guildId } from './define.js'

const ruleId = z.string().min(1).max(100)
const ruleShape = RuleInputSchema.shape

const patchShape = {
  trigger: ruleShape.trigger.optional(),
  conditions: ruleShape.conditions.removeDefault().optional(),
  actions: ruleShape.actions.optional(),
  cooldown_sec: ruleShape.cooldown_sec.removeDefault().optional(),
  allow_destructive: ruleShape.allow_destructive.removeDefault().optional(),
  enabled: ruleShape.enabled.removeDefault().optional(),
}

const assertRuleInGuild = async (ctx: ToolContext, gid: string, id: string): Promise<void> => {
  const rules = await ctx.services.rules.list(ctx.principal, gid)
  if (!rules.some((r) => r.id === id)) throw new McpToolError('not_found', `rule ${id} not found in this guild`)
}

export const serverWhoami = defineTool({
  name: 'server_whoami',
  group: 'meta',
  tier: 'read',
  unscoped: true,
  description: 'Show the identity and guilds of the calling principal (read).',
  input: {},
  guildFrom: () => null,
  handler: async (ctx) => ({
    data: {
      kind: ctx.principal.kind,
      user_id: ctx.principal.userId,
      user_name: ctx.principal.userName,
      guild_ids: Object.keys(ctx.principal.guilds),
    },
  }),
})

export const serverPolicy = defineTool({
  name: 'server_policy',
  group: 'meta',
  tier: 'read',
  unscoped: true,
  description: 'Show the effective safety policy for the calling principal (read).',
  input: {},
  guildFrom: () => null,
  handler: async (ctx) => ({ data: ctx.services.policy.effective(ctx.principal) }),
})

export const eventsPoll = defineTool({
  name: 'events_poll',
  group: 'meta',
  tier: 'read',
  description: 'Poll buffered gateway events of a guild after a cursor id (read).',
  input: {
    guild_id: guildId,
    since_id: z.number().int().min(0).default(0),
    types: z.array(z.enum(EVENT_TYPES)).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const q = defined({ guildId: i.guild_id, sinceId: i.since_id, types: i.types, limit: i.limit }) as Parameters<
      ToolContext['services']['events']['poll']
    >[1]
    const items = await ctx.services.events.poll(ctx.principal, q)
    const last = items[items.length - 1]
    return { data: last ? { items, next_cursor: String(last.id) } : { items } }
  },
})

export const rulesCreate = defineTool({
  name: 'rules_create',
  group: 'meta',
  tier: 'write',
  description: 'Create an automation rule for a guild (write).',
  input: { ...ruleShape, guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await ctx.services.rules.create(ctx.principal, i) }),
})

export const rulesList = defineTool({
  name: 'rules_list',
  group: 'meta',
  tier: 'read',
  description: 'List automation rules of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: { items: await ctx.services.rules.list(ctx.principal, i.guild_id) } }),
})

export const rulesUpdate = defineTool({
  name: 'rules_update',
  group: 'meta',
  tier: 'write',
  description: 'Update an automation rule of a guild (write).',
  input: { guild_id: guildId, rule_id: ruleId, ...patchShape },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, rule_id, ...patch }) => {
    await assertRuleInGuild(ctx, guild_id, rule_id)
    return { data: await ctx.services.rules.update(ctx.principal, rule_id, defined(patch)) }
  },
})

export const rulesDelete = defineTool({
  name: 'rules_delete',
  group: 'meta',
  tier: 'write',
  description: 'Delete an automation rule of a guild (write).',
  input: { guild_id: guildId, rule_id: ruleId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    await assertRuleInGuild(ctx, i.guild_id, i.rule_id)
    await ctx.services.rules.remove(ctx.principal, i.rule_id)
    return { data: { rule_id: i.rule_id } }
  },
})

export const rulesTest = defineTool({
  name: 'rules_test',
  group: 'meta',
  tier: 'read',
  description: 'Dry-run an automation rule against a sample event without executing actions (read).',
  input: {
    guild_id: guildId,
    rule_id: ruleId,
    sample_event: z.object({
      id: z.number().int().min(0),
      guildId,
      type: z.enum(EVENT_TYPES),
      at: z.iso.datetime({ offset: true }),
      data: z.record(z.string(), z.unknown()),
    }),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    if (i.sample_event.guildId !== i.guild_id) {
      throw new McpToolError('invalid_input', 'sample_event.guildId must equal guild_id')
    }
    await assertRuleInGuild(ctx, i.guild_id, i.rule_id)
    return { data: await ctx.services.rules.test(ctx.principal, i.rule_id, i.sample_event) }
  },
})

export const auditQuery = defineTool({
  name: 'audit_query',
  group: 'meta',
  tier: 'read',
  description: 'Query the discord-mcp tool-call audit trail of a guild (read).',
  input: {
    guild_id: guildId,
    tool: z.string().min(1).max(100).optional(),
    actor_user_id: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(200).default(50),
    before_id: z.number().int().min(0).optional(),
  },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    const q = defined({
      guildId: i.guild_id,
      tool: i.tool,
      actorUserId: i.actor_user_id,
      limit: i.limit,
      beforeId: i.before_id,
    }) as unknown as AuditQuery
    return { data: { items: await ctx.services.audit.query(ctx.principal, q) } }
  },
})

export const metaTools: AnyToolDef[] = [
  serverWhoami,
  serverPolicy,
  eventsPoll,
  rulesCreate,
  rulesList,
  rulesUpdate,
  rulesDelete,
  rulesTest,
  auditQuery,
]
