import { z } from 'zod'
import { EVENT_TYPES } from './events.js'

export const ConditionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('equals'), field: z.string(), value: z.unknown() }),
  z.object({ op: z.literal('matches'), field: z.string(), pattern: z.string().max(200) }),
  z.object({ op: z.literal('in'), field: z.string(), values: z.array(z.unknown()).max(100) }),
  z.object({ op: z.literal('member_has_role'), role_id: z.string() }),
  z.object({ op: z.literal('account_age_lt_days'), days: z.number().positive() }),
  z.object({ op: z.literal('message_contains'), text: z.string().min(1).max(200) }),
])
export type Condition = z.infer<typeof ConditionSchema>

export const ActionSpecSchema = z.object({
  tool: z.string(),
  input_template: z.record(z.string(), z.unknown()),
})
export type ActionSpec = z.infer<typeof ActionSpecSchema>

export const RuleInputSchema = z.object({
  guild_id: z.string(),
  trigger: z.object({ event: z.enum(EVENT_TYPES), filter: z.record(z.string(), z.unknown()).default({}) }),
  conditions: z.array(ConditionSchema).max(20).default([]),
  actions: z.array(ActionSpecSchema).min(1).max(10),
  cooldown_sec: z.number().int().min(0).max(86400).default(0),
  allow_destructive: z.boolean().default(false),
  enabled: z.boolean().default(true),
})
export type RuleInput = z.infer<typeof RuleInputSchema>

export interface Rule extends RuleInput {
  id: string
  owner_user_id: string | null
  created_at: string
  disabled_reason: string | null
}

export interface RuleTestResult { matched: boolean; actions: { tool: string; input: Record<string, unknown>; outcome: string }[] }
