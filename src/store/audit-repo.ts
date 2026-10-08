import type { AuditEntry, AuditQuery, NewAuditEntry, Tier } from '../contracts/index.js'
import type { Db } from './db.js'

export interface AuditRepo {
  insert(e: NewAuditEntry): AuditEntry
  query(q: AuditQuery): AuditEntry[]
}

interface Row {
  id: number
  at: string
  correlation_id: string
  tool: string
  tier: string
  guild_id: string | null
  actor: string
  actor_user_id: string | null
  input_hash: string
  outcome: AuditEntry['outcome']
  error_code: string | null
  latency_ms: number
}

const toEntry = (r: Row): AuditEntry => ({
  id: r.id,
  at: r.at,
  correlationId: r.correlation_id,
  tool: r.tool,
  tier: r.tier as Tier,
  guildId: r.guild_id,
  actor: r.actor,
  actorUserId: r.actor_user_id,
  inputHash: r.input_hash,
  outcome: r.outcome,
  errorCode: r.error_code,
  latencyMs: r.latency_ms,
})

export const createAuditRepo = (db: Db): AuditRepo => {
  const insertStmt = db.prepare(
    `INSERT INTO audit (at, correlation_id, tool, tier, guild_id, actor, actor_user_id, input_hash, outcome, error_code, latency_ms)
     VALUES (@at, @correlationId, @tool, @tier, @guildId, @actor, @actorUserId, @inputHash, @outcome, @errorCode, @latencyMs)`,
  )
  return {
    insert(e) {
      const info = insertStmt.run(e)
      return { id: Number(info.lastInsertRowid), ...e }
    },
    query(q) {
      const where: string[] = []
      const params: Record<string, unknown> = { limit: q.limit }
      if (q.guildId !== undefined) {
        where.push('guild_id = @guildId')
        params.guildId = q.guildId
      }
      if (q.tool !== undefined) {
        where.push('tool = @tool')
        params.tool = q.tool
      }
      if (q.actorUserId !== undefined) {
        where.push('actor_user_id = @actorUserId')
        params.actorUserId = q.actorUserId
      }
      if (q.beforeId !== undefined) {
        where.push('id < @beforeId')
        params.beforeId = q.beforeId
      }
      const sql = `SELECT * FROM audit ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT @limit`
      return (db.prepare(sql).all(params) as Row[]).map(toEntry)
    },
  }
}
