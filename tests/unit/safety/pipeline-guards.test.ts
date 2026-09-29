import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Principal, Services } from '../../../src/contracts/index.js'
import { createAuditWriter } from '../../../src/safety/audit.js'
import { createConfirmService } from '../../../src/safety/confirm.js'
import { createBulkLimiter } from '../../../src/safety/limiter.js'
import { PERM } from '../../../src/safety/permissions.js'
import { runTool } from '../../../src/safety/pipeline.js'
import type { PipelineDeps, RunOptions } from '../../../src/safety/pipeline.js'
import { PolicyEngine } from '../../../src/safety/policy.js'
import { rolesAssign, rolesCreate } from '../../../src/tools/roles.js'
import { openStore } from '../../../src/store/index.js'

const G = '111111111111111111'
const ME = '900000000000000002'
const LOW = '900000000000000003'
const OWNER = '900000000000000001'
const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

const roles = [
  { id: G, position: 0 },
  { id: '800000000000000001', position: 1 },
  { id: '800000000000000005', position: 5 },
  { id: '800000000000000009', position: 9 },
]
const members: Record<string, string[]> = { [ME]: ['800000000000000005'], [LOW]: ['800000000000000001'] }

describe('runTool guards with real tools', () => {
  let deps: PipelineDeps
  let opts: RunOptions
  let created: unknown[]
  let assigned: unknown[]

  beforeEach(() => {
    const store = openStore(':memory:')
    deps = {
      policy: new PolicyEngine({ guilds: { [G]: { max_tier: 'destructive' } }, tools: { deny: [] } }),
      confirm: createConfirmService({ store }),
      audit: createAuditWriter({ store, logger: log }),
      limiter: createBulkLimiter({ perMinute: 100 }),
    }
    created = []
    assigned = []
    opts = {
      discord: {
        getGuild: async () => ({ id: G, owner_id: OWNER }),
        getMember: async (_g: string, u: string) => ({ id: u, roles: members[u] ?? [] }),
        listRoles: async () => roles,
        createRole: async (_g: string, spec: unknown) => (created.push(spec), { id: '1' }),
        addMemberRole: async (...a: unknown[]) => void assigned.push(a),
      } as never,
      services: {} as Services,
      logger: log,
      correlationId: 'c',
    }
  })

  const manager: Principal = { kind: 'user', userId: ME, userName: 'm', guilds: { [G]: (PERM.MANAGE_GUILD | PERM.MANAGE_ROLES).toString() } }
  const stdio: Principal = { kind: 'stdio', userId: null, userName: 's', guilds: {} }
  const service: Principal = { kind: 'service', userId: null, userName: 'svc', guilds: {} }

  it('refuses Administrator the caller lacks, allows held bits', async () => {
    await expect(runTool(deps, rolesCreate, { guild_id: G, name: 'x', permissions: PERM.ADMINISTRATOR.toString() }, manager, opts)).rejects.toMatchObject({ code: 'missing_permissions' })
    expect(created).toHaveLength(0)
    await runTool(deps, rolesCreate, { guild_id: G, name: 'x', permissions: PERM.MANAGE_ROLES.toString() }, manager, opts)
    expect(created).toHaveLength(1)
  })

  it('refuses assigning a role at or above the caller, allows a lower one', async () => {
    for (const role_id of ['800000000000000005', '800000000000000009'])
      await expect(runTool(deps, rolesAssign, { guild_id: G, user_id: LOW, role_id }, manager, opts)).rejects.toMatchObject({ code: 'missing_permissions' })
    expect(assigned).toHaveLength(0)
    await runTool(deps, rolesAssign, { guild_id: G, user_id: LOW, role_id: '800000000000000001' }, manager, opts)
    expect(assigned).toHaveLength(1)
  })

  it('stdio and service principals are policy-only', async () => {
    for (const p of [stdio, service]) {
      await runTool(deps, rolesCreate, { guild_id: G, name: 'x', permissions: PERM.ADMINISTRATOR.toString() }, p, opts)
      await runTool(deps, rolesAssign, { guild_id: G, user_id: LOW, role_id: '800000000000000009' }, p, opts)
    }
    expect(created).toHaveLength(2)
    expect(assigned).toHaveLength(2)
  })
})
