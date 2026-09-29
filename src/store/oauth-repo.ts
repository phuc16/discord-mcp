import type { Db } from './db.js'

export interface OAuthClient { clientId: string; clientSecretHash: string | null; redirectUris: string[]; clientName: string; createdAt: string }
export interface PendingAuth { state: string; clientId: string; redirectUri: string; codeChallenge: string; clientState: string | null; scopes: string[]; expiresAt: number }
export interface AuthCode { codeHash: string; clientId: string; redirectUri: string; codeChallenge: string; userId: string; userName: string; guilds: Record<string, string>; expiresAt: number }
export interface Session {
  familyId: string
  accessHash: string
  refreshHash: string
  clientId: string
  userId: string
  userName: string
  guilds: Record<string, string>
  accessExpiresAt: number
  refreshExpiresAt: number
  revoked: boolean
}
export interface RotateInput {
  oldRefreshHash: string
  newRefreshHash: string
  newAccessHash: string
  accessExpiresAt: number
  refreshExpiresAt: number
  guilds: Record<string, string>
  now: number
}
export type RotateResult = { session: Session } | { reuse: true; familyId: string } | null

export interface OAuthRepo {
  saveClient(c: OAuthClient): void
  getClient(id: string): OAuthClient | null
  savePending(p: PendingAuth): void
  consumePending(state: string, now: number): PendingAuth | null
  saveCode(c: AuthCode): void
  consumeCode(codeHash: string, now: number): AuthCode | null
  peekCode(codeHash: string, now: number): AuthCode | null
  saveSession(s: Session): void
  getByAccessHash(h: string): Session | null
  getByRefreshHash(h: string): Session | null
  rotateRefresh(o: RotateInput): RotateResult
  revokeFamily(familyId: string): void
  revokeByTokenHash(h: string): void
  listSessionsForUser(userId: string): Session[]
}

interface SessionRow {
  family_id: string
  access_hash: string
  refresh_hash: string
  client_id: string
  user_id: string
  user_name: string
  guilds: string
  access_expires_at: number
  refresh_expires_at: number
  revoked: number
}

const toSession = (r: SessionRow): Session => ({
  familyId: r.family_id,
  accessHash: r.access_hash,
  refreshHash: r.refresh_hash,
  clientId: r.client_id,
  userId: r.user_id,
  userName: r.user_name,
  guilds: JSON.parse(r.guilds),
  accessExpiresAt: r.access_expires_at,
  refreshExpiresAt: r.refresh_expires_at,
  revoked: r.revoked === 1,
})

export const createOAuthRepo = (db: Db): OAuthRepo => {
  const one = <T>(sql: string, ...args: unknown[]): T | undefined => db.prepare(sql).get(...args) as T | undefined

  const consumePending = db.transaction((state: string, now: number): PendingAuth | null => {
    const row = one<Record<string, unknown>>('SELECT * FROM oauth_states WHERE state = ?', state)
    if (!row) return null
    db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state)
    if ((row.expires_at as number) <= now) return null
    return {
      state,
      clientId: row.client_id as string,
      redirectUri: row.redirect_uri as string,
      codeChallenge: row.code_challenge as string,
      clientState: row.client_state as string | null,
      scopes: JSON.parse(row.scopes as string),
      expiresAt: row.expires_at as number,
    }
  })

  const toCode = (codeHash: string, row: Record<string, unknown>): AuthCode => ({
    codeHash,
    clientId: row.client_id as string,
    redirectUri: row.redirect_uri as string,
    codeChallenge: row.code_challenge as string,
    userId: row.user_id as string,
    userName: row.user_name as string,
    guilds: JSON.parse(row.guilds as string),
    expiresAt: row.expires_at as number,
  })

  const consumeCode = db.transaction((codeHash: string, now: number): AuthCode | null => {
    const row = one<Record<string, unknown>>('SELECT * FROM oauth_codes WHERE code_hash = ?', codeHash)
    if (!row) return null
    db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').run(codeHash)
    return (row.expires_at as number) <= now ? null : toCode(codeHash, row)
  })

  const peekCode = (codeHash: string, now: number): AuthCode | null => {
    const row = one<Record<string, unknown>>('SELECT * FROM oauth_codes WHERE code_hash = ?', codeHash)
    return row && (row.expires_at as number) > now ? toCode(codeHash, row) : null
  }

  const revokeFamily = (familyId: string): void => void db.prepare('UPDATE oauth_sessions SET revoked = 1 WHERE family_id = ?').run(familyId)

  const rotateRefresh = db.transaction((o: RotateInput): RotateResult => {
    const row = one<SessionRow>('SELECT * FROM oauth_sessions WHERE refresh_hash = ?', o.oldRefreshHash)
    if (!row) {
      const past = one<{ family_id: string }>('SELECT family_id FROM oauth_refresh_history WHERE refresh_hash = ?', o.oldRefreshHash)
      if (!past) return null
      revokeFamily(past.family_id)
      return { reuse: true, familyId: past.family_id }
    }
    if (row.revoked === 1 || row.refresh_expires_at <= o.now) return null
    db.prepare('INSERT INTO oauth_refresh_history (refresh_hash, family_id) VALUES (?, ?)').run(row.refresh_hash, row.family_id)
    db.prepare(
      'UPDATE oauth_sessions SET refresh_hash = ?, access_hash = ?, access_expires_at = ?, refresh_expires_at = ?, guilds = ? WHERE family_id = ?',
    ).run(o.newRefreshHash, o.newAccessHash, o.accessExpiresAt, o.refreshExpiresAt, JSON.stringify(o.guilds), row.family_id)
    return { session: toSession(one<SessionRow>('SELECT * FROM oauth_sessions WHERE family_id = ?', row.family_id) as SessionRow) }
  })

  return {
    saveClient: (c) =>
      void db
        .prepare('INSERT OR REPLACE INTO oauth_clients (client_id, client_secret_hash, redirect_uris, client_name, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(c.clientId, c.clientSecretHash, JSON.stringify(c.redirectUris), c.clientName, c.createdAt),
    getClient(id) {
      const r = one<Record<string, unknown>>('SELECT * FROM oauth_clients WHERE client_id = ?', id)
      if (!r) return null
      return {
        clientId: r.client_id as string,
        clientSecretHash: r.client_secret_hash as string | null,
        redirectUris: JSON.parse(r.redirect_uris as string),
        clientName: r.client_name as string,
        createdAt: r.created_at as string,
      }
    },
    savePending: (p) =>
      void db
        .prepare('INSERT INTO oauth_states (state, client_id, redirect_uri, code_challenge, client_state, scopes, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(p.state, p.clientId, p.redirectUri, p.codeChallenge, p.clientState, JSON.stringify(p.scopes), p.expiresAt),
    consumePending: (state, now) => consumePending(state, now),
    saveCode: (c) =>
      void db
        .prepare('INSERT INTO oauth_codes (code_hash, client_id, redirect_uri, code_challenge, user_id, user_name, guilds, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(c.codeHash, c.clientId, c.redirectUri, c.codeChallenge, c.userId, c.userName, JSON.stringify(c.guilds), c.expiresAt),
    consumeCode: (h, now) => consumeCode(h, now),
    peekCode,
    saveSession: (s) =>
      void db
        .prepare(
          `INSERT INTO oauth_sessions (family_id, access_hash, refresh_hash, client_id, user_id, user_name, guilds, access_expires_at, refresh_expires_at, revoked)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(s.familyId, s.accessHash, s.refreshHash, s.clientId, s.userId, s.userName, JSON.stringify(s.guilds), s.accessExpiresAt, s.refreshExpiresAt, s.revoked ? 1 : 0),
    getByAccessHash(h) {
      const r = one<SessionRow>('SELECT * FROM oauth_sessions WHERE access_hash = ?', h)
      return r ? toSession(r) : null
    },
    getByRefreshHash(h) {
      const r = one<SessionRow>('SELECT * FROM oauth_sessions WHERE refresh_hash = ?', h)
      return r ? toSession(r) : null
    },
    rotateRefresh: (o) => rotateRefresh(o),
    revokeFamily,
    revokeByTokenHash: (h) => void db.prepare('UPDATE oauth_sessions SET revoked = 1 WHERE access_hash = ? OR refresh_hash = ?').run(h, h),
    listSessionsForUser: (userId) =>
      (db.prepare('SELECT * FROM oauth_sessions WHERE user_id = ? ORDER BY family_id').all(userId) as SessionRow[]).map(toSession),
  }
}
