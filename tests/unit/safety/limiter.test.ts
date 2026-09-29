import { describe, expect, it } from 'vitest'
import { createBulkLimiter } from '../../../src/safety/limiter.js'

describe('bulk limiter', () => {
  it('allows a burst up to perMinute then rejects', () => {
    let t = 0
    const l = createBulkLimiter({ perMinute: 3, now: () => t })
    for (let i = 0; i < 3; i++) expect(l.take('g')).toEqual({ ok: true })
    const r = l.take('g')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.retryAfterSec).toBeGreaterThanOrEqual(1)
  })

  it('refills over time', () => {
    let t = 0
    const l = createBulkLimiter({ perMinute: 3, now: () => t })
    for (let i = 0; i < 3; i++) l.take('g')
    expect(l.take('g').ok).toBe(false)
    t += 20_000
    expect(l.take('g').ok).toBe(true)
    expect(l.take('g').ok).toBe(false)
    t += 600_000
    for (let i = 0; i < 3; i++) expect(l.take('g').ok).toBe(true)
    expect(l.take('g').ok).toBe(false)
  })

  it('isolates guilds', () => {
    const l = createBulkLimiter({ perMinute: 1, now: () => 0 })
    expect(l.take('a').ok).toBe(true)
    expect(l.take('a').ok).toBe(false)
    expect(l.take('b').ok).toBe(true)
  })

  it('retryAfterSec reflects time to next token', () => {
    let t = 0
    const l = createBulkLimiter({ perMinute: 1, now: () => t })
    l.take('g')
    t = 10_000
    const r = l.take('g')
    expect(r).toEqual({ ok: false, retryAfterSec: 50 })
  })
})
