import { McpToolError } from '../contracts/index.js'
import type { AuditEntry, AuditPort, AuditQuery, Logger, NewAuditEntry, Principal } from '../contracts/index.js'
import type { Store } from '../store/index.js'
import type { PolicyEngine } from './policy.js'

export interface AuditWriter {
  write(e: NewAuditEntry): void
}

export const createAuditWriter = (d: { store: Store; logger: Logger }): AuditWriter => ({
  write(e) {
    d.store.audit.insert(e)
    d.logger.info(
      {
        correlation_id: e.correlationId,
        user_name: e.actor,
        tool: e.tool,
        tier: e.tier,
        guild_id: e.guildId,
        outcome: e.outcome,
        error_code: e.errorCode,
        latency: e.latencyMs,
      },
      'audit',
    )
  },
})

export const createAuditPort = (d: { store: Store; policy: PolicyEngine }): AuditPort => ({
  async query(principal: Principal, q: AuditQuery): Promise<AuditEntry[]> {
    if (q.guildId !== undefined) {
      if (!d.policy.canRead(principal, q.guildId)) throw new McpToolError('guild_not_allowed', 'guild not accessible')
      return d.store.audit.query(q)
    }
    const guilds = Object.keys(d.policy.effective(principal).guilds)
    const rows = guilds.flatMap((guildId) => d.store.audit.query({ ...q, guildId }))
    return rows.sort((a, b) => b.id - a.id).slice(0, q.limit)
  },
})
