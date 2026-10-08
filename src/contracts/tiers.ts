export const TIERS = ['read', 'write', 'destructive'] as const
export type Tier = (typeof TIERS)[number]
export const tierRank: Record<Tier, number> = { read: 0, write: 1, destructive: 2 }
export const isTier = (v: unknown): v is Tier => typeof v === 'string' && (TIERS as readonly string[]).includes(v)
export const minTier = (a: Tier, b: Tier): Tier => (tierRank[a] <= tierRank[b] ? a : b)
export const maxTier = (a: Tier, b: Tier): Tier => (tierRank[a] >= tierRank[b] ? a : b)
