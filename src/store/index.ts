import { createAuditRepo } from './audit-repo.js'
import type { AuditRepo } from './audit-repo.js'
import { createConfirmRepo } from './confirm-repo.js'
import type { ConfirmRepo } from './confirm-repo.js'
import { openDb } from './db.js'
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
  close(): void
}

export const openStore = (path: string): Store => {
  const db = openDb(path)
  return {
    audit: createAuditRepo(db),
    confirmations: createConfirmRepo(db),
    events: createEventRepo(db),
    rules: createRuleRepo(db),
    oauth: createOAuthRepo(db),
    close: () => void db.close(),
  }
}

export { schemaVersion } from './db.js'
export { migrations } from './migrations.js'
export type { AuditRepo, ConfirmRepo, EventRepo, RuleRepo, OAuthRepo }
export type { AuthCode, OAuthClient, PendingAuth, RotateInput, RotateResult, Session } from './oauth-repo.js'
