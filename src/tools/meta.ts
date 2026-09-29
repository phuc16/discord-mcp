import { z } from 'zod'
import {
  EVENT_TYPES,
  McpToolError,
  RuleInputSchema,
  type AnyToolDef,
  type AuditQuery,
  type ToolContext,
} from '../contracts/index.js'
import { auditLogTools } from './audit-log.js'
import { channelsTools } from './channels.js'
import { defineTool, defined, guildId } from './define.js'
import { emojisTools } from './emojis.js'
import { guildTools } from './guild.js'
import { invitesTools } from './invites.js'
import { membersTools } from './members.js'
import { messagesTools } from './messages.js'
import { moderationTools } from './moderation.js'
import { rolesTools } from './roles.js'
import { scheduledEventsTools } from './scheduled-events.js'
import { threadsTools } from './threads.js'
import { webhooksTools } from './webhooks.js'

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

const actionCatalog = (): AnyToolDef[] => [
  ...guildTools,
  ...channelsTools,
  ...threadsTools,
  ...rolesTools,
  ...membersTools,
  ...moderationTools,
  ...messagesTools,
  ...webhooksTools,
  ...scheduledEventsTools,
  ...invitesTools,
  ...emojisTools,
  ...auditLogTools,
  ...metaTools,
]

const destructiveActions = (actions: readonly { tool: string }[] | undefined): string[] => {
  const catalog = actionCatalog()
  return (actions ?? []).flatMap((a) => {
    const def = catalog.find((t) => t.name === a.tool)
    if (!def) throw new McpToolError('invalid_input', `rule action references unknown tool ${a.tool}`)
    return def.tier === 'destructive' ? [a.tool] : []
  })
}

const refuseDestructiveAtWriteTier = (variant: string, allowDestructive: boolean | undefined, actions: readonly { tool: string }[] | undefined): void => {
  const destructive = destructiveActions(actions)
  if (allowDestructive === true) {
    throw new McpToolError('invalid_input', `allow_destructive requires ${variant}, which is confirm-gated`)
  }
  if (destructive.length > 0) {
    throw new McpToolError('invalid_input', `destructive actions (${destructive.join(', ')}) require ${variant}, which is confirm-gated`)
  }
}

const describeRule = (r: { trigger?: { event: string; filter?: Record<string, unknown> } | undefined; actions?: readonly { tool: string; input_template: Record<string, unknown> }[] | undefined; allow_destructive?: boolean | undefined }): { triggers: string; actions: string[] } => ({
  triggers: r.trigger ? `${r.trigger.event} ${JSON.stringify(r.trigger.filter ?? {})}` : 'unchanged',
  actions: (r.actions ?? []).map((a) => `${a.tool} ${JSON.stringify(a.input_template)}`),
})

const rulePreview = (verb: string, r: Parameters<typeof describeRule>[0], guild: string) => {
  const d = describeRule(r)
  const destructive = destructiveActions(r.actions)
  return {
    summary: `${verb} automation rule in guild ${guild}: trigger ${d.triggers}; actions ${d.actions.join(' | ') || 'unchanged'}; allow_destructive=${String(r.allow_destructive ?? 'unchanged')}`,
    affected: { rules: 1, destructive_actions: destructive.length },
    details: { ...d, destructive_tools: destructive },
  }
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
    return { data: last ? { items, next_cursor: last.id } : { items } }
  },
})

export const rulesCreate = defineTool({
  name: 'rules_create',
  group: 'meta',
  tier: 'write',
  description: 'Create an automation rule for a guild; allow_destructive and destructive actions are refused, use rules_create_destructive (write).',
  input: { ...ruleShape, guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => {
    refuseDestructiveAtWriteTier('rules_create_destructive', i.allow_destructive, i.actions)
    return { data: await ctx.services.rules.create(ctx.principal, i) }
  },
})

export const rulesCreateDestructive = defineTool({
  name: 'rules_create_destructive',
  group: 'meta',
  tier: 'destructive',
  description: 'Create an automation rule that may run destructive actions or set allow_destructive; requires confirmation (destructive).',
  input: { ...ruleShape, guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  preview: async (_ctx, i) => rulePreview('Create', i, i.guild_id),
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
  description: 'Update an automation rule of a guild; allow_destructive and destructive actions are refused, use rules_update_destructive (write).',
  input: { guild_id: guildId, rule_id: ruleId, ...patchShape },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, { guild_id, rule_id, ...patch }) => {
    refuseDestructiveAtWriteTier('rules_update_destructive', patch.allow_destructive, patch.actions)
    await assertRuleInGuild(ctx, guild_id, rule_id)
    return { data: await ctx.services.rules.update(ctx.principal, rule_id, defined(patch)) }
  },
})

export const rulesUpdateDestructive = defineTool({
  name: 'rules_update_destructive',
  group: 'meta',
  tier: 'destructive',
  description: 'Update an automation rule to run destructive actions or set allow_destructive; requires confirmation (destructive).',
  input: { guild_id: guildId, rule_id: ruleId, ...patchShape },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, { guild_id, rule_id, ...patch }) => {
    await assertRuleInGuild(ctx, guild_id, rule_id)
    return rulePreview(`Update rule ${rule_id}:`, patch, guild_id)
  },
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
  rulesCreateDestructive,
  rulesList,
  rulesUpdate,
  rulesUpdateDestructive,
  rulesDelete,
  rulesTest,
  auditQuery,
]
