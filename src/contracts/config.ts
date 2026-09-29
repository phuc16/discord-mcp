import { z } from 'zod'
import { TIERS } from './tiers.js'

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake')

export const ConfigSchema = z.object({
  guilds: z.record(snowflake, z.object({ max_tier: z.enum(TIERS) })).refine((g) => Object.keys(g).length > 0, 'at least one guild required'),
  tools: z.object({ deny: z.array(z.string()).default([]) }).default({ deny: [] }),
  rate_limits: z.object({ bulk_per_minute: z.number().int().positive().default(5) }).default({ bulk_per_minute: 5 }),
  events: z
    .object({ retention_hours: z.number().positive().default(72), max_buffer: z.number().int().positive().default(50000) })
    .default({ retention_hours: 72, max_buffer: 50000 }),
  http: z
    .object({
      host: z.string().default('127.0.0.1'),
      port: z.number().int().min(1).max(65535).default(8787),
      trust_proxy: z.union([z.boolean(), z.number().int().positive(), z.string().min(1)]).default(false),
      allowed_redirect_uris: z.array(z.string().min(1)).default([]),
      max_clients: z.number().int().positive().default(1000),
      max_sessions_per_principal: z.number().int().positive().default(10),
      service_tokens: z.array(z.object({ name: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).default([]),
    })
    .default({
      host: '127.0.0.1',
      port: 8787,
      trust_proxy: false,
      allowed_redirect_uris: [],
      max_clients: 1000,
      max_sessions_per_principal: 10,
      service_tokens: [],
    }),
  safety: z.object({ allow_token_confirm: z.boolean().default(false) }).default({ allow_token_confirm: false }),
  rules: z
    .object({ max_per_guild: z.number().int().positive().default(50), min_cooldown_sec: z.number().int().min(0).default(1) })
    .default({ max_per_guild: 50, min_cooldown_sec: 1 }),
  message_content_intent: z.boolean().default(false),
  database_path: z.string().default('./discord-mcp.db'),
})
export type Config = z.infer<typeof ConfigSchema>
