import type { Config, EffectivePolicy, Principal, PolicyView, Tier } from '../contracts/index.js'
import { maxTier as higherTier, minTier } from '../contracts/index.js'
import { KNOWN_GROUPS, tierFromDiscordPermissions } from './permissions.js'

const parseBits = (raw: string): bigint | null => {
  try {
    return BigInt(raw)
  } catch {
    return null
  }
}

export class PolicyEngine implements PolicyView {
  private readonly guilds: Config['guilds']
  private readonly denied: ReadonlySet<string>

  constructor(config: Pick<Config, 'guilds' | 'tools'>) {
    this.guilds = config.guilds
    this.denied = new Set(config.tools.deny)
  }

  guildAllowed(guildId: string): boolean {
    return Object.hasOwn(this.guilds, guildId)
  }

  maxTier(guildId: string): Tier | null {
    return this.guildAllowed(guildId) ? this.guilds[guildId]!.max_tier : null
  }

  toolDenied(name: string): boolean {
    return this.denied.has(name)
  }

  effectiveTier(principal: Principal, guildId: string, group: string, tool?: string): Tier | null {
    const cap = this.maxTier(guildId)
    if (cap === null) return null
    if (principal.kind !== 'user') return cap
    const raw = principal.guilds[guildId]
    if (raw === undefined) return null
    const bits = parseBits(raw)
    if (bits === null) return null
    return minTier(cap, tierFromDiscordPermissions(bits, group, tool))
  }

  canRead(principal: Principal, guildId: string): boolean {
    return this.effectiveTier(principal, guildId, 'meta') !== null
  }

  effective(principal: Principal): EffectivePolicy {
    const guilds: EffectivePolicy['guilds'] = {}
    for (const id of Object.keys(this.guilds)) {
      const maxTier = this.guilds[id]!.max_tier
      let effectiveTier: Tier | null = null
      for (const g of KNOWN_GROUPS) {
        const t = this.effectiveTier(principal, id, g)
        if (t !== null) effectiveTier = effectiveTier === null ? t : higherTier(effectiveTier, t)
      }
      if (effectiveTier !== null) guilds[id] = { maxTier, effectiveTier }
    }
    return { guilds, deniedTools: [...this.denied] }
  }
}
