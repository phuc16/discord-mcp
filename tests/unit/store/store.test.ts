import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { McpToolError } from '../../../src/contracts/index.js'
import type { NewAuditEntry, Rule } from '../../../src/contracts/index.js'
import { migrations, openStore, schemaVersion } from '../../../src/store/index.js'
import type { Session } from '../../../src/store/index.js'

const audit = (o: Partial<NewAuditEntry> = {}): NewAuditEntry => ({
  at: '2026-01-01T00:00:00Z',
  correlationId: 'c',
  tool: 'guild_get',
  tier: 'read',
  guildId: '1',
  actor: 'u',
  actorUserId: 'u1',
  inputHash: 'h',
  outcome: 'ok',
  errorCode: null,
  latencyMs: 5,
  ...o,
})

describe('migrations', () => {
  it('sets schema_version and is idempotent across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-'))
    const path = join(dir, 'a.db')
    try {
      const s = openStore(path)
      s.audit.insert(audit())
      s.close()
      const s2 = openStore(path)
      expect(s2.audit.query({ limit: 10 })).toHaveLength(1)
      s2.close()
      const raw = new Database(path)
      expect(schemaVersion(raw)).toBe(migrations.length)
      expect(raw.pragma('journal_mode', { simple: true })).toBe('wal')
      raw.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('works in memory', () => {
    const s = openStore(':memory:')
    expect(s.events.latestId()).toBe(0)
    s.close()
  })
})

describe('AuditRepo', () => {
  it('returns newest first with filters and paging', () => {
    const s = openStore(':memory:')
    const a = s.audit.insert(audit({ tool: 'a', guildId: '1', actorUserId: 'x' }))
    const b = s.audit.insert(audit({ tool: 'b', guildId: '2', actorUserId: 'y' }))
    const c = s.audit.insert(audit({ tool: 'a', guildId: '2', actorUserId: 'x', errorCode: 'internal', outcome: 'error' }))
    expect(s.audit.query({ limit: 10 }).map((e) => e.id)).toEqual([c.id, b.id, a.id])
    expect(s.audit.query({ limit: 10, guildId: '2' }).map((e) => e.id)).toEqual([c.id, b.id])
    expect(s.audit.query({ limit: 10, tool: 'a' }).map((e) => e.id)).toEqual([c.id, a.id])
    expect(s.audit.query({ limit: 10, actorUserId: 'y' }).map((e) => e.id)).toEqual([b.id])
    expect(s.audit.query({ limit: 1, beforeId: c.id }).map((e) => e.id)).toEqual([b.id])
    expect(s.audit.query({ limit: 10 })[0]).toMatchObject({ errorCode: 'internal', outcome: 'error', correlationId: 'c' })
  })
})

describe('ConfirmRepo', () => {
  const base = { tokenHash: 't', inputHash: 'i', principalKey: 'user:1', tool: 'x', expiresAt: 1000 }
  const use = { tokenHash: 't', inputHash: 'i', principalKey: 'user:1', tool: 'x', now: 500 }
  it('consumes once', () => {
    const s = openStore(':memory:')
    s.confirmations.create(base)
    expect(s.confirmations.consume(use)).toBe('ok')
    expect(s.confirmations.consume(use)).toBe('invalid')
  })
  it('mismatches are invalid and do not consume', () => {
    const s = openStore(':memory:')
    s.confirmations.create(base)
    expect(s.confirmations.consume({ ...use, inputHash: 'z' })).toBe('invalid')
    expect(s.confirmations.consume({ ...use, principalKey: 'user:2' })).toBe('invalid')
    expect(s.confirmations.consume({ ...use, tool: 'y' })).toBe('invalid')
    expect(s.confirmations.consume({ ...use, tokenHash: 'nope' })).toBe('invalid')
    expect(s.confirmations.consume(use)).toBe('ok')
  })
  it('expired', () => {
    const s = openStore(':memory:')
    s.confirmations.create(base)
    expect(s.confirmations.consume({ ...use, now: 1000 })).toBe('expired')
  })
})

describe('EventRepo', () => {
  const ev = (guildId: string, type: 'message_create' | 'member_join', at = '2026-01-01T00:00:00Z') => ({ guildId, type, at, data: { n: 1 } })
  it('appends with monotonic ids and filters since', () => {
    const s = openStore(':memory:')
    const e1 = s.events.append(ev('1', 'message_create'))
    const e2 = s.events.append(ev('2', 'message_create'))
    const e3 = s.events.append(ev('1', 'member_join'))
    expect(e2.id).toBeGreaterThan(e1.id)
    expect(s.events.latestId()).toBe(e3.id)
    expect(s.events.since({ guildId: '1', sinceId: 0, limit: 10 }).map((e) => e.id)).toEqual([e1.id, e3.id])
    expect(s.events.since({ guildId: '1', sinceId: e1.id, limit: 10 }).map((e) => e.id)).toEqual([e3.id])
    expect(s.events.since({ guildId: '1', sinceId: 0, types: ['member_join'], limit: 10 }).map((e) => e.id)).toEqual([e3.id])
    expect(s.events.since({ guildId: '1', sinceId: 0, limit: 1 })).toHaveLength(1)
    expect(s.events.since({ guildId: '1', sinceId: 0, limit: 1 })[0]?.data).toEqual({ n: 1 })
  })
  it('prunes by age and by max rows keeping newest', () => {
    const s = openStore(':memory:')
    s.events.append(ev('1', 'message_create', '2020-01-01T00:00:00Z'))
    const keep = [1, 2, 3].map(() => s.events.append(ev('1', 'message_create', '2026-06-01T00:00:00Z')))
    expect(s.events.prune({ olderThanIso: '2025-01-01T00:00:00Z', maxRows: 100 })).toBe(1)
    expect(s.events.prune({ olderThanIso: '2025-01-01T00:00:00Z', maxRows: 2 })).toBe(1)
    expect(s.events.since({ guildId: '1', sinceId: 0, limit: 10 }).map((e) => e.id)).toEqual([keep[1]!.id, keep[2]!.id])
  })
})

describe('EventRepo recent and gap', () => {
  const ev = (type: 'message_create' | 'member_join' | 'gap', guildId = '1') => ({ guildId, type, at: '2026-01-01T00:00:00Z', data: {} })
  it('recent returns newest n ascending', () => {
    const s = openStore(':memory:')
    const all = Array.from({ length: 150 }, () => s.events.append(ev('message_create')))
    s.events.append(ev('message_create', '2'))
    const r = s.events.recent('1', 100)
    expect(r).toHaveLength(100)
    expect(r[0]!.id).toBe(all[50]!.id)
    expect(r[99]!.id).toBe(all[149]!.id)
  })
  it('type filter still returns gap events', () => {
    const s = openStore(':memory:')
    s.events.append(ev('message_create'))
    const g = s.events.append(ev('gap'))
    const j = s.events.append(ev('member_join'))
    expect(s.events.since({ guildId: '1', sinceId: 0, types: ['member_join'], limit: 10 }).map((e) => e.id)).toEqual([g.id, j.id])
  })
})

describe('RuleRepo', () => {
  const rule = (o: Partial<Rule> = {}): Rule => ({
    id: 'r1',
    guild_id: '1',
    owner_user_id: 'u',
    created_at: '2026-01-01T00:00:00Z',
    disabled_reason: null,
    trigger: { event: 'member_join', filter: { a: 1 } },
    conditions: [{ op: 'message_contains', text: 'x' }],
    actions: [{ tool: 'members_add_role', input_template: { role_id: '5' } }],
    cooldown_sec: 10,
    allow_destructive: false,
    enabled: true,
    ...o,
  })
  it('round trips and lists', () => {
    const s = openStore(':memory:')
    s.rules.insert(rule())
    s.rules.insert(rule({ id: 'r2', guild_id: '2' }))
    expect(s.rules.get('r1')).toEqual(rule())
    expect(s.rules.get('nope')).toBeNull()
    expect(s.rules.list().map((r) => r.id)).toEqual(['r1', 'r2'])
    expect(s.rules.list('2').map((r) => r.id)).toEqual(['r2'])
  })
  it('updates and deletes', () => {
    const s = openStore(':memory:')
    s.rules.insert(rule())
    expect(s.rules.update('r1', { enabled: false, disabled_reason: 'x' })).toMatchObject({ enabled: false, disabled_reason: 'x', id: 'r1' })
    expect(s.rules.get('r1')?.enabled).toBe(false)
    expect(() => s.rules.update('zz', {})).toThrow(McpToolError)
    s.rules.delete('r1')
    expect(s.rules.get('r1')).toBeNull()
  })
  it('listByEvent returns enabled rules for guild and event', () => {
    const s = openStore(':memory:')
    s.rules.insert(rule())
    s.rules.insert(rule({ id: 'off', enabled: false }))
    s.rules.insert(rule({ id: 'other', trigger: { event: 'member_remove', filter: {} } }))
    expect(s.rules.listByEvent('1', 'member_join').map((r) => r.id)).toEqual(['r1'])
  })
  it('cooldown', () => {
    const s = openStore(':memory:')
    s.rules.insert(rule())
    expect(s.rules.getCooldownUntil('r1')).toBe(0)
    s.rules.setCooldownUntil('r1', 99)
    expect(s.rules.getCooldownUntil('r1')).toBe(99)
    expect(s.rules.getCooldownUntil('missing')).toBe(0)
  })
})

describe('migration safety', () => {
  it('refuses a newer schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-'))
    const path = join(dir, 'n.db')
    try {
      openStore(path).close()
      const raw = new Database(path)
      raw.prepare("UPDATE meta SET value = '999' WHERE key = 'schema_version'").run()
      raw.close()
      expect(() => openStore(path)).toThrow(/newer/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('single instance lock', () => {
  it('refuses a second open of the same database and releases on close', () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-'))
    const path = join(dir, 'l.db')
    try {
      const a = openStore(path)
      expect(() => openStore(path)).toThrow(/already in use/)
      a.close()
      openStore(path).close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('takes over a stale lock left by a dead process', () => {
    const dir = mkdtempSync(join(tmpdir(), 'store-'))
    const path = join(dir, 's.db')
    try {
      writeFileSync(`${path}.lock`, '2147483646')
      openStore(path).close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
  it('pings', () => {
    const s = openStore(':memory:')
    expect(() => s.ping()).not.toThrow()
    s.close()
    expect(() => s.ping()).toThrow()
  })
})

describe('pruneExpired and helpers', () => {
  it('removes expired state and keeps live rows', () => {
    const s = openStore(':memory:')
    const pend = (state: string, expiresAt: number) => ({ state, clientId: 'c', redirectUri: 'r', codeChallenge: 'x', clientState: null, scopes: [], expiresAt })
    s.oauth.savePending(pend('old', 50))
    s.oauth.savePending(pend('new', 500))
    const code = (h: string, expiresAt: number) => ({ codeHash: h, clientId: 'c', redirectUri: 'r', codeChallenge: 'x', userId: 'u', userName: 'n', guilds: {}, expiresAt })
    s.oauth.saveCode(code('oldc', 50))
    s.oauth.saveCode(code('newc', 500))
    const sess = (familyId: string, refreshExpiresAt: number, revoked = false) => ({
      familyId, accessHash: `a${familyId}`, refreshHash: `r${familyId}`, clientId: 'c', userId: 'u', userName: 'n', guilds: {}, accessExpiresAt: 10, refreshExpiresAt, revoked,
    })
    s.oauth.saveSession(sess('exp', 50))
    s.oauth.saveSession(sess('rev', 500, true))
    s.oauth.saveSession(sess('live', 500))
    s.oauth.rotateRefresh({ oldRefreshHash: 'rexp', newRefreshHash: 'rexp2', newAccessHash: 'aexp2', accessExpiresAt: 10, refreshExpiresAt: 50, guilds: {}, now: 1 })
    s.oauth.recordCodeFamily('oldc', 'exp')
    s.confirmations.create({ tokenHash: 'ct', inputHash: 'i', principalKey: 'p', tool: 't', expiresAt: 50 })
    s.confirmations.create({ tokenHash: 'cl', inputHash: 'i', principalKey: 'p', tool: 't', expiresAt: 500 })
    s.pruneExpired(100)
    expect(s.oauth.consumePending('old', 1)).toBeNull()
    expect(s.oauth.consumePending('new', 1)).not.toBeNull()
    expect(s.oauth.peekCode('newc', 1)).not.toBeNull()
    expect(s.oauth.getByRefreshHash('rexp2')).toBeNull()
    expect(s.oauth.getByRefreshHash('rrev')).toBeNull()
    expect(s.oauth.getByRefreshHash('rlive')).not.toBeNull()
    expect(s.oauth.rotateRefresh({ oldRefreshHash: 'rexp', newRefreshHash: 'z', newAccessHash: 'z', accessExpiresAt: 1, refreshExpiresAt: 1, guilds: {}, now: 1 })).toBeNull()
    expect(s.oauth.familyForUsedCode('oldc')).toBeNull()
    expect(s.confirmations.consume({ tokenHash: 'ct', inputHash: 'i', principalKey: 'p', tool: 't', now: 1 })).toBe('invalid')
    expect(s.confirmations.consume({ tokenHash: 'cl', inputHash: 'i', principalKey: 'p', tool: 't', now: 1 })).toBe('ok')
  })
  it('counts clients and maps used codes to families', () => {
    const s = openStore(':memory:')
    expect(s.oauth.countClients()).toBe(0)
    s.oauth.saveClient({ clientId: 'c', clientSecretHash: null, redirectUris: [], clientName: 'n', createdAt: 't' })
    expect(s.oauth.countClients()).toBe(1)
    expect(s.oauth.familyForUsedCode('h')).toBeNull()
    s.oauth.recordCodeFamily('h', 'fam')
    expect(s.oauth.familyForUsedCode('h')).toBe('fam')
  })
})

describe('OAuthRepo', () => {
  const session = (o: Partial<Session> = {}): Session => ({
    familyId: 'f1',
    accessHash: 'a1',
    refreshHash: 'r1',
    clientId: 'c',
    userId: 'u',
    userName: 'name',
    guilds: { '1': '8' },
    accessExpiresAt: 1000,
    refreshExpiresAt: 5000,
    revoked: false,
    ...o,
  })
  const rot = (o: Partial<Parameters<ReturnType<typeof openStore>['oauth']['rotateRefresh']>[0]> = {}) => ({
    oldRefreshHash: 'r1',
    newRefreshHash: 'r2',
    newAccessHash: 'a2',
    accessExpiresAt: 2000,
    refreshExpiresAt: 6000,
    guilds: { '1': '16' },
    now: 100,
    ...o,
  })

  it('client round trip', () => {
    const s = openStore(':memory:')
    const c = { clientId: 'c', clientSecretHash: null, redirectUris: ['http://x/cb'], clientName: 'n', createdAt: 't' }
    s.oauth.saveClient(c)
    expect(s.oauth.getClient('c')).toEqual(c)
    expect(s.oauth.getClient('z')).toBeNull()
    s.oauth.saveClient({ ...c, clientId: 'd', createdAt: 'u' })
    expect(s.oauth.listClients().map((x) => x.clientId)).toEqual(['c', 'd'])
  })
  it('pending is single use and expires', () => {
    const s = openStore(':memory:')
    const p = { state: 's', clientId: 'c', redirectUri: 'r', codeChallenge: 'cc', clientState: null, scopes: ['a'], expiresAt: 100 }
    s.oauth.savePending(p)
    expect(s.oauth.consumePending('s', 50)).toEqual(p)
    expect(s.oauth.consumePending('s', 50)).toBeNull()
    s.oauth.savePending(p)
    expect(s.oauth.consumePending('s', 100)).toBeNull()
    expect(s.oauth.consumePending('s', 50)).toBeNull()
  })
  it('code is single use and expires', () => {
    const s = openStore(':memory:')
    const c = { codeHash: 'h', clientId: 'c', redirectUri: 'r', codeChallenge: 'cc', userId: 'u', userName: 'n', guilds: { '1': '8' }, expiresAt: 100 }
    s.oauth.saveCode(c)
    expect(s.oauth.consumeCode('h', 50)).toEqual(c)
    expect(s.oauth.consumeCode('h', 50)).toBeNull()
    s.oauth.saveCode(c)
    expect(s.oauth.consumeCode('h', 101)).toBeNull()
  })
  it('peekCode does not consume and respects expiry', () => {
    const s = openStore(':memory:')
    const c = { codeHash: 'h', clientId: 'c', redirectUri: 'r', codeChallenge: 'cc', userId: 'u', userName: 'n', guilds: { '1': '8' }, expiresAt: 100 }
    s.oauth.saveCode(c)
    expect(s.oauth.peekCode('h', 50)).toEqual(c)
    expect(s.oauth.peekCode('h', 50)).toEqual(c)
    expect(s.oauth.peekCode('h', 100)).toBeNull()
    expect(s.oauth.peekCode('zz', 50)).toBeNull()
    expect(s.oauth.consumeCode('h', 50)).toEqual(c)
    expect(s.oauth.peekCode('h', 50)).toBeNull()
  })
  it('session lookup and listing', () => {
    const s = openStore(':memory:')
    s.oauth.saveSession(session())
    expect(s.oauth.getByAccessHash('a1')).toEqual(session())
    expect(s.oauth.getByAccessHash('zz')).toBeNull()
    expect(s.oauth.listSessionsForUser('u')).toHaveLength(1)
    expect(s.oauth.listSessionsForUser('other')).toHaveLength(0)
  })
  it('looks up by refresh hash including revoked', () => {
    const s = openStore(':memory:')
    s.oauth.saveSession(session())
    expect(s.oauth.getByRefreshHash('r1')).toEqual(session())
    s.oauth.revokeFamily('f1')
    expect(s.oauth.getByRefreshHash('r1')?.revoked).toBe(true)
    expect(s.oauth.getByRefreshHash('nope')).toBeNull()
  })
  it('rotates refresh tokens', () => {
    const s = openStore(':memory:')
    s.oauth.saveSession(session())
    const r = s.oauth.rotateRefresh(rot())
    expect(r).toMatchObject({ session: { familyId: 'f1', refreshHash: 'r2', accessHash: 'a2', guilds: { '1': '16' }, refreshExpiresAt: 6000 } })
    expect(s.oauth.getByAccessHash('a1')).toBeNull()
    expect(s.oauth.getByAccessHash('a2')?.familyId).toBe('f1')
  })
  it('detects reuse and revokes the family', () => {
    const s = openStore(':memory:')
    s.oauth.saveSession(session())
    s.oauth.rotateRefresh(rot())
    expect(s.oauth.rotateRefresh(rot())).toEqual({ reuse: true, familyId: 'f1' })
    expect(s.oauth.getByAccessHash('a2')?.revoked).toBe(true)
    expect(s.oauth.rotateRefresh(rot({ oldRefreshHash: 'r2', newRefreshHash: 'r3', newAccessHash: 'a3' }))).toBeNull()
  })
  it('rotation returns null when unknown or expired', () => {
    const s = openStore(':memory:')
    s.oauth.saveSession(session())
    expect(s.oauth.rotateRefresh(rot({ oldRefreshHash: 'nope' }))).toBeNull()
    expect(s.oauth.rotateRefresh(rot({ now: 5000 }))).toBeNull()
  })
  it('lists active sessions and updates guilds', () => {
    const s = openStore(':memory:')
    s.oauth.saveSession(session())
    s.oauth.saveSession(session({ familyId: 'f2', accessHash: 'a2', refreshHash: 'r2', refreshExpiresAt: 50 }))
    s.oauth.saveSession(session({ familyId: 'f3', accessHash: 'a3', refreshHash: 'r3', revoked: true }))
    expect(s.oauth.listActiveSessions(100).map((x) => x.familyId)).toEqual(['f1'])
    s.oauth.updateSessionGuilds('f1', { '9': '32' })
    expect(s.oauth.getByAccessHash('a1')?.guilds).toEqual({ '9': '32' })
  })
  it('revokes by token hash and by family', () => {
    const s = openStore(':memory:')
    s.oauth.saveSession(session())
    s.oauth.saveSession(session({ familyId: 'f2', accessHash: 'a9', refreshHash: 'r9' }))
    s.oauth.revokeByTokenHash('a1')
    expect(s.oauth.getByAccessHash('a1')?.revoked).toBe(true)
    s.oauth.revokeByTokenHash('r9')
    expect(s.oauth.getByAccessHash('a9')?.revoked).toBe(true)
    s.oauth.saveSession(session({ familyId: 'f3', accessHash: 'a3', refreshHash: 'r3' }))
    s.oauth.revokeFamily('f3')
    expect(s.oauth.getByAccessHash('a3')?.revoked).toBe(true)
  })
})
