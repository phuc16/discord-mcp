import type { z } from 'zod'
import type { DiscordPort } from './discord-port.js'
import type { Principal } from './principal.js'
import type { Services } from './services.js'
import type { Tier } from './tiers.js'

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void
  warn(obj: Record<string, unknown>, msg?: string): void
  error(obj: Record<string, unknown>, msg?: string): void
  debug(obj: Record<string, unknown>, msg?: string): void
}

export interface Guards {
  assertCanGrantPermissions(guildId: string, bits: string | bigint): void
  assertCanPlaceRole(guildId: string, position: number): Promise<void>
  assertCanActOnRole(guildId: string, roleId: string): Promise<void>
  assertCanActOnMember(guildId: string, userId: string, opts?: { allowSelf?: boolean }): Promise<void>
}

export interface ToolContext {
  discord: DiscordPort
  principal: Principal
  correlationId: string
  logger: Logger
  services: Services
  guards: Guards
}

export interface PreviewResult { summary: string; affected: Record<string, number>; details?: unknown }
export interface ToolResult { data: unknown; partial?: boolean }

export interface ToolDef<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
  name: string
  group: string
  description: string
  tier: Tier
  unscoped?: boolean
  input: S
  guildFrom: (input: z.infer<S>) => string | null
  preview?: (ctx: ToolContext, input: z.infer<S>) => Promise<PreviewResult>
  handler: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolResult>
}

export type AnyToolDef = ToolDef<z.ZodObject<z.ZodRawShape>>
