import type { Tier } from './tiers.js'

export interface AuditEntry {
  id: number
  at: string
  correlationId: string
  tool: string
  tier: Tier
  guildId: string | null
  actor: string
  actorUserId: string | null
  inputHash: string
  outcome: 'ok' | 'dry_run' | 'denied' | 'error'
  errorCode: string | null
  latencyMs: number
}
export type NewAuditEntry = Omit<AuditEntry, 'id'>
export interface AuditQuery { guildId?: string; tool?: string; actorUserId?: string; limit: number; beforeId?: number }
