import { beforeEach, describe, expect, it } from 'vitest'
import type { Principal } from '../../../src/contracts/index.js'
import { openStore } from '../../../src/store/index.js'
import type { Store } from '../../../src/store/index.js'
import { createConfirmService, hashInput, hashToken } from '../../../src/safety/confirm.js'

const alice: Principal = { kind: 'user', userId: 'a', userName: 'alice', guilds: {} }
const bob: Principal = { kind: 'user', userId: 'b', userName: 'bob', guilds: {} }

describe('confirm service', () => {
  let store: Store
  let clock: number
  beforeEach(() => {
    store = openStore(':memory:')
    clock = 1_000_000
  })
  const svc = () => createConfirmService({ store, now: () => clock })

  it('hashInput is key-order independent', () => {
    expect(hashInput({ a: 1, b: 2 })).toBe(hashInput({ b: 2, a: 1 }))
    expect(hashInput({ a: 1 })).not.toBe(hashInput({ a: 2 }))
  })

  it('issue then verify ok, replay invalid', () => {
    const s = svc()
    const { token, expiresAt } = s.issue('t', { x: 1 }, alice)
    expect(expiresAt).toBe(clock + 300000)
    expect(s.verify('t', { x: 1 }, alice, token)).toBe('ok')
    expect(s.verify('t', { x: 1 }, alice, token)).toBe('invalid')
  })

  it('mutated input, other principal, other tool are invalid', () => {
    const s = svc()
    const a = s.issue('t', { x: 1 }, alice)
    expect(s.verify('t', { x: 2 }, alice, a.token)).toBe('invalid')
    expect(s.verify('t', { x: 1 }, bob, a.token)).toBe('invalid')
    expect(s.verify('u', { x: 1 }, alice, a.token)).toBe('invalid')
    expect(s.verify('t', { x: 1 }, alice, a.token)).toBe('ok')
  })

  it('unknown token invalid', () => {
    expect(svc().verify('t', {}, alice, 'nope')).toBe('invalid')
  })

  it('expires after ttl', () => {
    const s = svc()
    const { token } = s.issue('t', {}, alice)
    clock += 300001
    expect(s.verify('t', {}, alice, token)).toBe('expired')
  })

  it('token is url-safe, 32 bytes, unique', () => {
    const s = svc()
    const a = s.issue('t', {}, alice).token
    const b = s.issue('t', {}, alice).token
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })

  it('stores only the hash', () => {
    const s = svc()
    const { token } = s.issue('t', {}, alice)
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashToken(token)).not.toBe(token)
    const seen = store.confirmations.consume({ tokenHash: token, inputHash: hashInput({}), principalKey: 'user:a', tool: 't', now: clock })
    expect(seen).toBe('invalid')
  })
})
