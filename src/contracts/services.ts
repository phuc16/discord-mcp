import type { AuditEntry, AuditQuery } from './audit.js'
import type { EventType, NormalizedEvent } from './events.js'
import type { Principal } from './principal.js'
import type { Rule, RuleInput, RuleTestResult } from './rules.js'
import type { Tier } from './tiers.js'

export interface EventsPort {
  poll(principal: Principal, q: { guildId: string; sinceId: number; types?: EventType[]; limit: number }): Promise<NormalizedEvent[]>
}

export interface RulesPort {
  create(principal: Principal, input: RuleInput): Promise<Rule>
  list(principal: Principal, guildId: string): Promise<Rule[]>
  update(principal: Principal, id: string, patch: Partial<RuleInput>): Promise<Rule>
  remove(principal: Principal, id: string): Promise<void>
  test(principal: Principal, id: string, sample: NormalizedEvent): Promise<RuleTestResult>
}

export interface AuditPort {
  query(principal: Principal, q: AuditQuery): Promise<AuditEntry[]>
}

export interface EffectivePolicy {
  guilds: Record<string, { maxTier: Tier; effectiveTier: Tier }>
  deniedTools: string[]
}
export interface PolicyView { effective(principal: Principal): EffectivePolicy }

export interface Services { events: EventsPort; rules: RulesPort; audit: AuditPort; policy: PolicyView }
