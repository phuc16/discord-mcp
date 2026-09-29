import { randomUUID } from 'node:crypto'
import { McpToolError, RuleInputSchema, tierRank } from '../contracts/index.js'
import type {
  AnyToolDef, DiscordPort, Logger, NormalizedEvent, Principal, Rule, RuleInput, RuleTestResult, RulesPort, Services,
} from '../contracts/index.js'
import type { PipelineDeps, PolicyEngine, Store } from '../safety/index.js'
import { createRuleEngine } from './engine.js'
import { eventMatches } from './match.js'
import { renderTemplate, templateReferences } from './template.js'

export interface RulesService extends RulesPort {
  start(): void
  stop(): void
  disableForOwner(userId: string, reason: string): void
  handleEvent(e: NormalizedEvent): Promise<void>
  idle(): Promise<void>
}

const inputOf = (r: Rule): RuleInput => ({
  guild_id: r.guild_id,
  trigger: r.trigger,
  conditions: r.conditions,
  actions: r.actions,
  cooldown_sec: r.cooldown_sec,
  allow_destructive: r.allow_destructive,
  enabled: r.enabled,
})

export const createRulesService = (d: {
  store: Store
  policy: PolicyEngine
  pipeline: PipelineDeps
  subscribe: (cb: (e: NormalizedEvent) => void) => () => void
  toolByName: (name: string) => AnyToolDef | undefined
  discord: DiscordPort
  services: () => Services
  logger: Logger
  now?: () => number
  newId?: () => string
}): RulesService => {
  const now = d.now ?? Date.now
  const newId = d.newId ?? randomUUID
  const engine = createRuleEngine({
    store: d.store, pipeline: d.pipeline, toolByName: d.toolByName, discord: d.discord, services: d.services, logger: d.logger, now,
  })

  let off: (() => void) | null = null
  let chain: Promise<void> = Promise.resolve()

  const requireGuild = (guildId: string): void => {
    if (!d.policy.guildAllowed(guildId)) throw new McpToolError('guild_not_allowed', 'guild not allowed')
  }

  const validate = (principal: Principal, input: RuleInput): void => {
    requireGuild(input.guild_id)
    const base = d.policy.effectiveTier(principal, input.guild_id, 'meta')
    if (base === null) throw new McpToolError('guild_not_allowed', 'guild not accessible')
    if (tierRank[base] < tierRank.write) throw new McpToolError('tier_exceeded', 'write tier required to manage rules', { required: 'write', effective: base })
    for (const spec of input.actions) {
      const def = d.toolByName(spec.tool)
      if (!def) throw new McpToolError('invalid_input', `unknown action tool ${spec.tool}`)
      const bad = templateReferences(spec.input_template).find((p) => !p.startsWith('event.'))
      if (bad !== undefined) throw new McpToolError('invalid_input', `template may only reference event.*: ${bad}`)
      if (def.tier === 'destructive' && !input.allow_destructive) {
        throw new McpToolError('invalid_input', `action ${def.name} is destructive; allow_destructive must be true`)
      }
      const effective = d.policy.effectiveTier(principal, input.guild_id, def.group)
      if (effective === null || tierRank[def.tier] > tierRank[effective]) {
        throw new McpToolError('tier_exceeded', `tier too low for ${def.name}`, { required: def.tier, effective })
      }
    }
  }

  const owned = (principal: Principal, id: string): Rule => {
    const rule = d.store.rules.get(id)
    if (!rule) throw new McpToolError('not_found', `rule ${id} not found`)
    requireGuild(rule.guild_id)
    if (principal.kind === 'user' && rule.owner_user_id !== principal.userId) {
      throw new McpToolError('unauthorized', 'rule is owned by another user')
    }
    return rule
  }

  const enqueue = (e: NormalizedEvent): Promise<void> => {
    chain = chain.then(() => engine.handle(e)).catch((err: unknown) => {
      d.logger.error({ err: err instanceof Error ? err.message : String(err) }, 'rules event handling failed')
    })
    return chain
  }

  return {
    start() {
      if (off) return
      off = d.subscribe((e) => void enqueue(e))
    },
    stop() {
      off?.()
      off = null
    },
    handleEvent: enqueue,
    idle: () => chain,

    disableForOwner(userId, reason) {
      for (const rule of d.store.rules.list()) {
        if (rule.owner_user_id === userId && rule.enabled) engine.disable(rule, reason)
      }
    },

    async create(principal, raw) {
      const input = RuleInputSchema.parse(raw)
      validate(principal, input)
      const rule: Rule = { ...input, id: newId(), owner_user_id: principal.userId, created_at: new Date(now()).toISOString(), disabled_reason: null }
      d.store.rules.insert(rule)
      return rule
    },

    async list(principal, guildId) {
      requireGuild(guildId)
      if (!d.policy.canRead(principal, guildId)) throw new McpToolError('guild_not_allowed', 'guild not accessible')
      return d.store.rules.list(guildId)
    },

    async update(principal, id, patch) {
      const rule = owned(principal, id)
      const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) as Partial<RuleInput>
      if (defined.guild_id !== undefined && defined.guild_id !== rule.guild_id) {
        throw new McpToolError('invalid_input', 'rule guild cannot be changed')
      }
      const merged = RuleInputSchema.parse({ ...inputOf(rule), ...defined })
      validate(principal, merged)
      const next: Partial<Rule> = { ...merged }
      if (merged.enabled) next.disabled_reason = null
      return d.store.rules.update(id, next)
    },

    async remove(principal, id) {
      owned(principal, id)
      d.store.rules.delete(id)
    },

    async test(principal, id, sample) {
      const rule = d.store.rules.get(id)
      if (!rule) throw new McpToolError('not_found', `rule ${id} not found`)
      requireGuild(rule.guild_id)
      if (!d.policy.canRead(principal, rule.guild_id)) throw new McpToolError('guild_not_allowed', 'guild not accessible')
      const result: RuleTestResult = { matched: eventMatches(rule, sample, now()), actions: [] }
      if (!result.matched) return result
      for (const spec of rule.actions) {
        try {
          const rendered = renderTemplate(spec.input_template, sample)
          const def = d.toolByName(spec.tool)
          const blocked = def?.tier === 'destructive' && !rule.allow_destructive
          result.actions.push({
            tool: spec.tool,
            input: def?.unscoped ? rendered : { ...rendered, guild_id: rule.guild_id },
            outcome: blocked ? 'blocked_destructive' : 'would_run',
          })
        } catch (err) {
          result.actions.push({ tool: spec.tool, input: {}, outcome: `error: ${err instanceof Error ? err.message : String(err)}` })
        }
      }
      return result
    },
  }
}
