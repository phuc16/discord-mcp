export interface BulkLimiter {
  take(guildId: string): { ok: true } | { ok: false; retryAfterSec: number }
}

export const createBulkLimiter = (d: { perMinute: number; now?: () => number }): BulkLimiter => {
  const now = d.now ?? Date.now
  const refillPerMs = d.perMinute / 60000
  const buckets = new Map<string, { tokens: number; at: number }>()
  return {
    take(guildId) {
      const t = now()
      const b = buckets.get(guildId) ?? { tokens: d.perMinute, at: t }
      b.tokens = Math.min(d.perMinute, b.tokens + (t - b.at) * refillPerMs)
      b.at = t
      buckets.set(guildId, b)
      if (b.tokens >= 1) {
        b.tokens -= 1
        return { ok: true }
      }
      return { ok: false, retryAfterSec: Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000)) }
    },
  }
}
