import { McpToolError, tierRank } from '../contracts/index.js'
import type { AnyToolDef, DiscordPort, Logger, NormalizedEvent, Principal, Rule, Services } from '../contracts/index.js'
import { createBulkLimiter, hashInput, runTool } from '../safety/index.js'
import type { PipelineDeps, Store } from '../safety/index.js'
import { eventMatches } from './match.js'
import { renderTemplate } from './template.js'

export interface EngineDeps {
  store: Store
  pipeline: PipelineDeps
  toolByName: (name: string) => AnyToolDef | undefined
  discord: DiscordPort
  services: () => Services
  logger: Logger
  now: () => number
}

export interface RuleEngine {
  handle(e: NormalizedEvent): Promise<void>
  disable(rule: Rule, reason: string, errorCode?: string): void
  principalFor(rule: Rule): Principal
}

const GUARD_TTL_MS = 30_000
const ACTIONS_PER_MINUTE = 30
const SNOWFLAKE = /^\d{17,20}$/
const PRIMARY_KEYS: Record<string, string> = {
  message_create: 'message_id', message_update: 'message_id', message_delete: 'message_id',
  member_join: 'user_id', member_remove: 'user_id', member_ban: 'user_id', member_unban: 'user_id', voice_state: 'user_id',
  role_create: 'role_id', role_update: 'role_id', role_delete: 'role_id',
  channel_create: 'channel_id', channel_update: 'channel_id', channel_delete: 'channel_id',
  scheduled_event: 'event_id',
}

const collectIds = (v: unknown, out: Set<string>, depth = 0): void => {
  if (depth > 4) return
  if (typeof v === 'string') {
    if (SNOWFLAKE.test(v)) out.add(v)
  } else if (Array.isArray(v)) {
    for (const x of v) collectIds(x, out, depth + 1)
  } else if (v !== null && typeof v === 'object') {
    for (const x of Object.values(v)) collectIds(x, out, depth + 1)
  }
}

export const createRuleEngine = (d: EngineDeps): RuleEngine => {
  const limiter = createBulkLimiter({ perMinute: ACTIONS_PER_MINUTE, now: d.now })
  const touched = new Map<string, number>()

  const touchKey = (ruleId: string, guildId: string, id: string): string => `${ruleId}:${guildId}:${id}`

  const sweep = (): void => {
    const t = d.now()
    for (const [k, exp] of touched) if (exp <= t) touched.delete(k)
  }

  const isSelfCaused = (rule: Rule, e: NormalizedEvent): boolean => {
    sweep()
    const key = PRIMARY_KEYS[e.type]
    const id = key ? e.data[key] : undefined
    return typeof id === 'string' && touched.has(touchKey(rule.id, rule.guild_id, id))
  }

  const markTouched = (rule: Rule, value: unknown): void => {
    const ids = new Set<string>()
    collectIds(value, ids)
    ids.delete(rule.guild_id)
    const exp = d.now() + GUARD_TTL_MS
    for (const id of ids) touched.set(touchKey(rule.id, rule.guild_id, id), exp)
  }

  const principalFor = (rule: Rule): Principal => {
    if (rule.owner_user_id === null) return { kind: 'service', userId: null, userName: `rule:${rule.id}`, guilds: {} }
    const now = d.now()
    const sessions = d.store.oauth.listSessionsForUser(rule.owner_user_id).filter((s) => !s.revoked && s.refreshExpiresAt > now)
    const guilds: Record<string, string> = {}
    for (const s of sessions) {
      for (const [g, bits] of Object.entries(s.guilds)) {
        guilds[g] = (BigInt(guilds[g] ?? '0') | BigInt(bits)).toString()
      }
    }
    return { kind: 'user', userId: rule.owner_user_id, userName: sessions[0]?.userName ?? `owner:${rule.owner_user_id}`, guilds }
  }

  const audit = (
    rule: Rule,
    tool: string,
    tier: AnyToolDef['tier'],
    outcome: 'denied' | 'error',
    errorCode: string,
    correlationId: string,
    principal: Principal,
  ): void => {
    d.pipeline.audit.write({
      at: new Date(d.now()).toISOString(),
      correlationId,
      tool,
      tier,
      guildId: rule.guild_id,
      actor: principal.userName,
      actorUserId: principal.userId,
      inputHash: hashInput({ rule_id: rule.id }),
      outcome,
      errorCode,
      latencyMs: 0,
    })
  }

  const disable = (rule: Rule, reason: string, errorCode = 'tier_exceeded'): void => {
    d.store.rules.update(rule.id, { enabled: false, disabled_reason: reason })
    audit(rule, 'rules_auto_disable', 'write', 'denied', errorCode, `rule:${rule.id}`, principalFor(rule))
    d.logger.warn({ correlation_id: `rule:${rule.id}`, rule_id: rule.id, reason }, 'rule disabled')
  }

  const execute = async (rule: Rule, e: NormalizedEvent): Promise<void> => {
    const correlationId = `rule:${rule.id}:${e.id}`
    const principal = principalFor(rule)
    const planned: { def: AnyToolDef; input: Record<string, unknown> }[] = []

    for (const spec of rule.actions) {
      const def = d.toolByName(spec.tool)
      if (!def) return disable(rule, `unknown tool ${spec.tool}`, 'invalid_input')
      const effective = d.pipeline.policy.effectiveTier(principal, rule.guild_id, def.group)
      if (effective === null || tierRank[def.tier] > tierRank[effective]) {
        return disable(rule, `owner tier below ${def.tier} required by ${def.name}`)
      }
    }

    for (const spec of rule.actions) {
      const def = d.toolByName(spec.tool)!
      try {
        const rendered = renderTemplate(spec.input_template, e)
        const target = rendered.guild_id
        if (target !== undefined && target !== rule.guild_id) {
          audit(rule, def.name, def.tier, 'denied', 'guild_not_allowed', correlationId, principal)
          return
        }
        planned.push({ def, input: def.unscoped ? rendered : { ...rendered, guild_id: rule.guild_id } })
      } catch (err) {
        d.logger.warn({ correlation_id: correlationId, rule_id: rule.id, err: err instanceof Error ? err.message : String(err) }, 'rule template failed')
        audit(rule, def.name, def.tier, 'error', 'invalid_input', correlationId, principal)
        return
      }
    }

    for (const { def, input } of planned) {
      if (def.tier === 'destructive' && !rule.allow_destructive) {
        audit(rule, def.name, def.tier, 'denied', 'confirm_required', correlationId, principal)
        return
      }
      if (!limiter.take(rule.guild_id).ok) {
        audit(rule, def.name, def.tier, 'denied', 'rate_limited', correlationId, principal)
        return
      }
      markTouched(rule, input)
      try {
        const result = await runTool(d.pipeline, def, input, principal, {
          discord: d.discord,
          services: d.services(),
          logger: d.logger,
          correlationId,
          preauthorized: def.tier === 'destructive',
        })
        markTouched(rule, result.data)
      } catch (err) {
        const code = err instanceof McpToolError ? err.code : 'internal'
        d.logger.warn({ correlation_id: correlationId, rule_id: rule.id, tool: def.name, error_code: code }, 'rule action failed')
        return
      }
    }
  }

  return {
    principalFor,
    disable,
    async handle(e) {
      const now = d.now()
      for (const rule of d.store.rules.listByEvent(e.guildId, e.type)) {
        if (!eventMatches(rule, e, now) || isSelfCaused(rule, e)) continue
        if (d.store.rules.getCooldownUntil(rule.id) > now) continue
        if (rule.cooldown_sec > 0) d.store.rules.setCooldownUntil(rule.id, now + rule.cooldown_sec * 1000)
        try {
          await execute(rule, e)
        } catch (err) {
          d.logger.error({ correlation_id: `rule:${rule.id}:${e.id}`, rule_id: rule.id, err: err instanceof Error ? err.message : String(err) }, 'rule execution failed')
        }
      }
    },
  }
}

