import { createHash, randomBytes } from 'node:crypto'
import { canonicalJson, principalKey } from '../contracts/index.js'
import type { Principal } from '../contracts/index.js'
import type { Store } from '../store/index.js'

export const hashInput = (input: unknown): string => createHash('sha256').update(canonicalJson(input)).digest('hex')

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export interface ConfirmService {
  issue(tool: string, input: unknown, principal: Principal): { token: string; expiresAt: number }
  verify(tool: string, input: unknown, principal: Principal, token: string): 'ok' | 'invalid' | 'expired'
}

export const createConfirmService = (d: { store: Store; now?: () => number; ttlMs?: number }): ConfirmService => {
  const now = d.now ?? Date.now
  const ttlMs = d.ttlMs ?? 300000
  return {
    issue(tool, input, principal) {
      const token = randomBytes(32).toString('base64url')
      const expiresAt = now() + ttlMs
      d.store.confirmations.create({
        tokenHash: hashToken(token),
        inputHash: hashInput(input),
        principalKey: principalKey(principal),
        tool,
        expiresAt,
      })
      return { token, expiresAt }
    },
    verify(tool, input, principal, token) {
      return d.store.confirmations.consume({
        tokenHash: hashToken(token),
        inputHash: hashInput(input),
        principalKey: principalKey(principal),
        tool,
        now: now(),
      })
    },
  }
}
