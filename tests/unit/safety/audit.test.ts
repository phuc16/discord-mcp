import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewAuditEntry, Principal } from '../../../src/contracts/index.js'
import { openStore } from '../../../src/store/index.js'
import type { Store } from '../../../src/store/index.js'
import { PERM } from '../../../src/safety/permissions.js'
import { PolicyEngine } from '../../../src/safety/policy.js'
import { createAuditPort, createAuditWriter } from '../../../src/safety/audit.js'

const G = '111111111111111111'
const H = '222222222222222222'

const entry = (over: Partial<NewAuditEntry> = {}): NewAuditEntry => ({
  at: '2026-01-01T00:00:00.000Z',
  correlationId: 'c1',
  tool: 'roles_delete',
  tier: 'destructive',
  guildId: G,
  actor: 'alice',
  actorUserId: 'a',
  inputHash: 'h',
  outcome: 'ok',
  errorCode: null,
  latencyMs: 5,
  ...over,
})

describe('audit', () => {
  let store: Store
  beforeEach(() => {
    store = openStore(':memory:')
  })

  it('writer inserts a row and logs with underscore fields', () => {
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
    createAuditWriter({ store, logger }).write(entry())
    expect(store.audit.query({ limit: 10 })).toHaveLength(1)
    const [obj] = logger.info.mock.calls[0]!
    expect(obj).toMatchObject({ correlation_id: 'c1', user_name: 'alice', tool: 'roles_delete', outcome: 'ok', guild_id: G })
    expect(JSON.stringify(obj)).not.toContain('"input"')
  })

  describe('port', () => {
    const policy = new PolicyEngine({ guilds: { [G]: { max_tier: 'write' }, [H]: { max_tier: 'write' } }, tools: { deny: [] } })
    const port = () => createAuditPort({ store, policy })
    const user: Principal = { kind: 'user', userId: 'a', userName: 'alice', guilds: { [G]: PERM.MANAGE_GUILD.toString() } }
    const stdio: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }

    beforeEach(() => {
      store.audit.insert(entry({ guildId: G }))
      store.audit.insert(entry({ guildId: H }))
      store.audit.insert(entry({ guildId: null, outcome: 'denied' }))
    })

    it('rejects a guild the principal cannot read', async () => {
      await expect(port().query(user, { guildId: H, limit: 10 })).rejects.toMatchObject({ code: 'guild_not_allowed' })
    })

    it('allows a readable guild', async () => {
      expect(await port().query(user, { guildId: G, limit: 10 })).toHaveLength(1)
    })

    it('without guild filter returns only readable guild rows', async () => {
      const rows = await port().query(user, { limit: 10 })
      expect(rows.map((r) => r.guildId)).toEqual([G])
    })

    it('stdio sees all allowlisted guilds, merged newest first and limited', async () => {
      const rows = await port().query(stdio, { limit: 1 })
      expect(rows).toHaveLength(1)
      expect(rows[0]!.guildId).toBe(H)
      expect((await port().query(stdio, { limit: 10 })).map((r) => r.guildId)).toEqual([H, G])
    })
  })
})
