import { createAuditRepo } from './audit-repo.js'
import type { AuditRepo } from './audit-repo.js'
import { createConfirmRepo } from './confirm-repo.js'
import type { ConfirmRepo } from './confirm-repo.js'
import { openDb } from './db.js'
import type { Db } from './db.js'
import { createEventRepo } from './event-repo.js'
import type { EventRepo } from './event-repo.js'
import { createOAuthRepo } from './oauth-repo.js'
import type { OAuthRepo } from './oauth-repo.js'
import { createRuleRepo } from './rule-repo.js'
import type { RuleRepo } from './rule-repo.js'

export interface Store {
  audit: AuditRepo
  confirmations: ConfirmRepo
  events: EventRepo
  rules: RuleRepo
  oauth: OAuthRepo
  pruneExpired(now: number): void
  close(): void
}

const pruneExpired = (db: Db, now: number): void =>
  void db.transaction(() => {
    db.prepare('DELETE FROM oauth_states WHERE expires_at <= ?').run(now)
    db.prepare('DELETE FROM oauth_codes WHERE expires_at <= ?').run(now)
    const dead = "SELECT family_id FROM oauth_sessions WHERE revoked = 1 OR refresh_expires_at <= ?"
    db.prepare(`DELETE FROM oauth_refresh_history WHERE family_id IN (${dead})`).run(now)
    db.prepare(`DELETE FROM oauth_code_families WHERE family_id IN (${dead})`).run(now)
    db.prepare('DELETE FROM oauth_sessions WHERE revoked = 1 OR refresh_expires_at <= ?').run(now)
    db.prepare('DELETE FROM confirmations WHERE expires_at <= ?').run(now)
  })()

export const openStore = (path: string): Store => {
  const db = openDb(path)
  return {
    audit: createAuditRepo(db),
    confirmations: createConfirmRepo(db),
    events: createEventRepo(db),
    rules: createRuleRepo(db),
    oauth: createOAuthRepo(db),
    pruneExpired: (now) => pruneExpired(db, now),
    close: () => void db.close(),
  }
}

export { schemaVersion } from './db.js'
export { migrations } from './migrations.js'
export type { AuditRepo, ConfirmRepo, EventRepo, RuleRepo, OAuthRepo }
export type { AuthCode, OAuthClient, PendingAuth, RotateInput, RotateResult, Session } from './oauth-repo.js'
