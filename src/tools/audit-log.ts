import { z } from 'zod'
import type { AnyToolDef } from '../contracts/index.js'
import { defineTool, defined, guildId, snowflake } from './define.js'

type AuditFilter = { user_id?: string; action_type?: number; limit?: number; before?: string }
const limit = z.number().int().min(1).max(100).optional()

export const auditLogList = defineTool({
  name: 'audit_log_list',
  group: 'audit_log',
  tier: 'read',
  description: 'List recent Discord audit log entries of a guild (read).',
  input: { guild_id: guildId, limit, before: snowflake.optional() },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({
    data: await ctx.discord.listAuditLog(i.guild_id, defined({ limit: i.limit, before: i.before }) as AuditFilter),
  }),
})

export const auditLogByUser = defineTool({
  name: 'audit_log_by_user',
  group: 'audit_log',
  tier: 'read',
  description: 'List Discord audit log entries caused by one user (read).',
  input: { guild_id: guildId, user_id: snowflake, limit },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({
    data: await ctx.discord.listAuditLog(i.guild_id, defined({ user_id: i.user_id, limit: i.limit }) as AuditFilter),
  }),
})

export const auditLogByAction = defineTool({
  name: 'audit_log_by_action',
  group: 'audit_log',
  tier: 'read',
  description: 'List Discord audit log entries of one action type (read).',
  input: { guild_id: guildId, action_type: z.number().int().min(1), limit },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({
    data: await ctx.discord.listAuditLog(i.guild_id, defined({ action_type: i.action_type, limit: i.limit }) as AuditFilter),
  }),
})

export const auditLogTools: AnyToolDef[] = [auditLogList, auditLogByUser, auditLogByAction]
