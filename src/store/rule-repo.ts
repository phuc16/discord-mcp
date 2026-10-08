import { McpToolError } from '../contracts/index.js'
import type { EventType, Rule } from '../contracts/index.js'
import type { Db } from './db.js'

export interface RuleRepo {
  insert(r: Rule): void
  get(id: string): Rule | null
  list(guildId?: string): Rule[]
  update(id: string, patch: Partial<Rule>): Rule
  delete(id: string): void
  listByEvent(guildId: string, type: EventType): Rule[]
  getCooldownUntil(id: string): number
  setCooldownUntil(id: string, ms: number): void
}

interface Row {
  id: string
  guild_id: string
  owner_user_id: string | null
  created_at: string
  disabled_reason: string | null
  enabled: number
  trigger_event: EventType
  trigger_filter: string
  conditions: string
  actions: string
  cooldown_sec: number
  allow_destructive: number
}

const toRule = (r: Row): Rule => ({
  id: r.id,
  guild_id: r.guild_id,
  owner_user_id: r.owner_user_id,
  created_at: r.created_at,
  disabled_reason: r.disabled_reason,
  enabled: r.enabled === 1,
  trigger: { event: r.trigger_event, filter: JSON.parse(r.trigger_filter) },
  conditions: JSON.parse(r.conditions),
  actions: JSON.parse(r.actions),
  cooldown_sec: r.cooldown_sec,
  allow_destructive: r.allow_destructive === 1,
})

const toParams = (r: Rule) => ({
  id: r.id,
  guildId: r.guild_id,
  ownerUserId: r.owner_user_id,
  createdAt: r.created_at,
  disabledReason: r.disabled_reason,
  enabled: r.enabled ? 1 : 0,
  triggerEvent: r.trigger.event,
  triggerFilter: JSON.stringify(r.trigger.filter),
  conditions: JSON.stringify(r.conditions),
  actions: JSON.stringify(r.actions),
  cooldownSec: r.cooldown_sec,
  allowDestructive: r.allow_destructive ? 1 : 0,
})

export const createRuleRepo = (db: Db): RuleRepo => {
  const insert = db.prepare(
    `INSERT INTO rules (id, guild_id, owner_user_id, created_at, disabled_reason, enabled, trigger_event, trigger_filter, conditions, actions, cooldown_sec, allow_destructive)
     VALUES (@id, @guildId, @ownerUserId, @createdAt, @disabledReason, @enabled, @triggerEvent, @triggerFilter, @conditions, @actions, @cooldownSec, @allowDestructive)`,
  )
  const replace = db.prepare(
    `UPDATE rules SET guild_id=@guildId, owner_user_id=@ownerUserId, created_at=@createdAt, disabled_reason=@disabledReason, enabled=@enabled,
     trigger_event=@triggerEvent, trigger_filter=@triggerFilter, conditions=@conditions, actions=@actions, cooldown_sec=@cooldownSec,
     allow_destructive=@allowDestructive WHERE id=@id`,
  )
  const getStmt = db.prepare('SELECT * FROM rules WHERE id = ?')
  const get = (id: string): Rule | null => {
    const row = getStmt.get(id) as Row | undefined
    return row ? toRule(row) : null
  }
  const update = db.transaction((id: string, patch: Partial<Rule>): Rule => {
    const current = get(id)
    if (!current) throw new McpToolError('not_found', `rule ${id} not found`)
    const next: Rule = { ...current, ...patch, id }
    replace.run(toParams(next))
    return next
  })
  return {
    insert: (r) => void insert.run(toParams(r)),
    get,
    list(guildId) {
      const rows = guildId === undefined
        ? db.prepare('SELECT * FROM rules ORDER BY created_at, id').all()
        : db.prepare('SELECT * FROM rules WHERE guild_id = ? ORDER BY created_at, id').all(guildId)
      return (rows as Row[]).map(toRule)
    },
    update: (id, patch) => update(id, patch),
    delete: (id) => void db.prepare('DELETE FROM rules WHERE id = ?').run(id),
    listByEvent: (guildId, type) =>
      (db.prepare('SELECT * FROM rules WHERE guild_id = ? AND trigger_event = ? AND enabled = 1 ORDER BY created_at, id').all(guildId, type) as Row[]).map(toRule),
    getCooldownUntil: (id) => ((db.prepare('SELECT cooldown_until FROM rules WHERE id = ?').get(id) as { cooldown_until: number } | undefined)?.cooldown_until ?? 0),
    setCooldownUntil: (id, ms) => void db.prepare('UPDATE rules SET cooldown_until = ? WHERE id = ?').run(ms, id),
  }
}
