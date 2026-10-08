import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { McpToolError } from '../../../src/contracts/index.js'
import type { AnyToolDef, Principal, Services, Tier, ToolContext } from '../../../src/contracts/index.js'
import { openStore } from '../../../src/store/index.js'
import type { Store } from '../../../src/store/index.js'
import { createAuditWriter } from '../../../src/safety/audit.js'
import { createConfirmService } from '../../../src/safety/confirm.js'
import { createBulkLimiter } from '../../../src/safety/limiter.js'
import { PERM } from '../../../src/safety/permissions.js'
import { runTool } from '../../../src/safety/pipeline.js'
import type { PipelineDeps, RunOptions } from '../../../src/safety/pipeline.js'
import { PolicyEngine } from '../../../src/safety/policy.js'

const G = '111111111111111111'
const H = '222222222222222222'
const C = '333333333333333333'
const D = '444444444444444444'

const admin: Principal = { kind: 'user', userId: 'a', userName: 'alice', guilds: { [G]: PERM.ADMINISTRATOR.toString(), [H]: PERM.ADMINISTRATOR.toString() } }
const reader: Principal = { kind: 'user', userId: 'r', userName: 'rita', guilds: { [G]: '0' } }
const stdio: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }

const logger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })

const mk = (over: {
  name?: string
  tier: Tier
  handler?: (ctx: ToolContext, i: never) => Promise<{ data: unknown }>
  unscoped?: boolean
  guildFrom?: (i: Record<string, unknown>) => string | null
  preview?: boolean
}): AnyToolDef =>
  ({
    name: over.name ?? 'thing',
    group: 'channels',
    description: 'd',
    tier: over.tier,
    unscoped: over.unscoped,
    input: z.object({ guild_id: z.string().optional(), channel_id: z.string().optional(), confirm_token: z.string().optional() }),
    guildFrom: over.guildFrom ?? ((i) => (i.guild_id as string | undefined) ?? null),
    preview:
      over.tier === 'destructive' && over.preview !== false
        ? async () => ({ summary: 'delete it', affected: { channels: 1 } })
        : undefined,
    handler: (over.handler ?? (async () => ({ data: 'done' }))) as AnyToolDef['handler'],
  }) as AnyToolDef

describe('runTool', () => {
  let store: Store
  let clock: number
  let deps: PipelineDeps
  let opts: RunOptions
  let log: ReturnType<typeof logger>

  const build = (deny: string[] = [], perMinute = 100, allowTokenConfirm = false) => {
    const policy = new PolicyEngine({
      guilds: { [G]: { max_tier: 'destructive' }, [H]: { max_tier: 'write' } },
      tools: { deny },
    })
    deps = {
      policy,
      confirm: createConfirmService({ store, now: () => clock }),
      audit: createAuditWriter({ store, logger: log }),
      limiter: createBulkLimiter({ perMinute, now: () => clock }),
      allowTokenConfirm,
      now: () => clock,
    }
  }
  const audits = () => store.audit.query({ limit: 50 }).reverse()

  beforeEach(() => {
    store = openStore(':memory:')
    clock = 1_000_000
    log = logger()
    build()
    opts = { discord: {} as never, services: {} as Services, logger: log, correlationId: 'corr-1' }
  })

  it('denied tool -> tier_exceeded and audit denied with null guild', async () => {
    build(['thing'])
    const def = mk({ tier: 'read' })
    await expect(runTool(deps, def, { guild_id: G }, admin, opts)).rejects.toMatchObject({ code: 'tier_exceeded', message: 'tool disabled by policy' })
    expect(audits()).toMatchObject([{ outcome: 'denied', guildId: null, tool: 'thing', correlationId: 'corr-1' }])
  })

  it('invalid input -> invalid_input with paths', async () => {
    const def = mk({ tier: 'read' })
    const err = await runTool(deps, def, { guild_id: 5 }, admin, opts).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpToolError)
    expect((err as McpToolError).code).toBe('invalid_input')
    expect(JSON.stringify((err as McpToolError).details)).toContain('guild_id')
    expect(audits()[0]).toMatchObject({ outcome: 'error', errorCode: 'invalid_input' })
  })

  it('guild not in allowlist -> guild_not_allowed', async () => {
    const def = mk({ tier: 'read' })
    await expect(runTool(deps, def, { guild_id: '999999999999999999' }, admin, opts)).rejects.toMatchObject({ code: 'guild_not_allowed' })
    expect(audits()[0]).toMatchObject({ outcome: 'denied', errorCode: 'guild_not_allowed', guildId: '999999999999999999' })
  })

  it('user with no access to guild -> guild_not_allowed', async () => {
    const def = mk({ tier: 'read' })
    await expect(runTool(deps, def, { guild_id: H }, reader, opts)).rejects.toMatchObject({ code: 'guild_not_allowed' })
  })

  it('tier exceeded when user capped below tool tier', async () => {
    const def = mk({ tier: 'write' })
    await expect(runTool(deps, def, { guild_id: G }, reader, opts)).rejects.toMatchObject({
      code: 'tier_exceeded',
      details: { required: 'write', effective: 'read' },
    })
    await expect(runTool(deps, mk({ tier: 'destructive' }), { guild_id: H }, admin, opts)).rejects.toMatchObject({
      code: 'tier_exceeded',
      details: { required: 'destructive', effective: 'write' },
    })
  })

  it('null-guild read tool ok, null-guild write tool rejected', async () => {
    const readDef = mk({ tier: 'read', unscoped: true, guildFrom: () => null })
    await expect(runTool(deps, readDef, {}, stdio, opts)).resolves.toEqual({ data: 'done' })
    const writeDef = mk({ tier: 'write', guildFrom: () => null })
    await expect(runTool(deps, writeDef, {}, stdio, opts)).rejects.toMatchObject({ code: 'guild_not_allowed' })
  })

  it('bulk tools are rate limited per guild', async () => {
    build([], 1)
    const def = mk({ name: 'roles_bulk_assign', tier: 'write' })
    await runTool(deps, def, { guild_id: G }, admin, opts)
    await expect(runTool(deps, def, { guild_id: G }, admin, opts)).rejects.toMatchObject({
      code: 'rate_limited',
      details: { retry_after: expect.any(Number) },
    })
    await runTool(deps, def, { guild_id: H }, admin, opts)
  })

  it('non-bulk tools are not rate limited', async () => {
    build([], 1)
    const def = mk({ tier: 'write' })
    await runTool(deps, def, { guild_id: G }, admin, opts)
    await runTool(deps, def, { guild_id: G }, admin, opts)
  })

  describe('destructive (default: elicitation required)', () => {
    const accept = async () => 'accept' as const
    const input = { guild_id: G, channel_id: C }

    it('no elicit support fails closed without a token', async () => {
      const handler = vi.fn(async () => ({ data: 'done' }))
      const def = mk({ tier: 'destructive', handler })
      const err = (await runTool(deps, def, input, admin, opts).catch((e: unknown) => e)) as McpToolError
      expect(err.code).toBe('confirm_required')
      expect(err.details.confirm_token).toBeUndefined()
      expect(err.details.preview).toMatchObject({ summary: 'delete it' })
      expect(handler).not.toHaveBeenCalled()
    })

    it('a supplied confirm_token is ignored when token flow is off', async () => {
      const handler = vi.fn(async () => ({ data: 'done' }))
      const def = mk({ tier: 'destructive', handler })
      await expect(runTool(deps, def, { ...input, confirm_token: 'x'.repeat(20) }, admin, opts)).rejects.toMatchObject({ code: 'confirm_required' })
      expect(handler).not.toHaveBeenCalled()
    })

    it('elicit unsupported and elicit throwing both fail closed', async () => {
      const def = mk({ tier: 'destructive' })
      const a = (await runTool(deps, def, input, admin, { ...opts, elicit: async () => 'unsupported' }).catch((e: unknown) => e)) as McpToolError
      expect(a.code).toBe('confirm_required')
      expect(a.details.confirm_token).toBeUndefined()
      const b = (await runTool(deps, def, input, admin, { ...opts, elicit: async () => { throw new Error('boom') } }).catch((e: unknown) => e)) as McpToolError
      expect(b.code).toBe('confirm_required')
      expect(b.details.confirm_token).toBeUndefined()
      expect(log.warn).toHaveBeenCalled()
    })

    it('elicitation accept runs handler for every principal kind', async () => {
      const handler = vi.fn(async () => ({ data: 'ok' }))
      const elicit = vi.fn(accept)
      const def = mk({ tier: 'destructive', handler })
      await expect(runTool(deps, def, { guild_id: G }, admin, { ...opts, elicit })).resolves.toEqual({ data: 'ok' })
      await expect(runTool(deps, def, { guild_id: G }, stdio, { ...opts, elicit })).resolves.toEqual({ data: 'ok' })
      expect(elicit).toHaveBeenCalledWith('delete it')
      expect(handler).toHaveBeenCalledTimes(2)
    })

    it('elicitation decline is denied with no token', async () => {
      const handler = vi.fn()
      const def = mk({ tier: 'destructive', handler })
      await expect(runTool(deps, def, input, admin, { ...opts, elicit: async () => 'decline' })).rejects.toMatchObject({
        code: 'confirm_invalid',
        message: 'declined by user',
      })
      expect(handler).not.toHaveBeenCalled()
    })

    it('sanitizes untrusted text in the elicitation prompt', async () => {
      const def = mk({ tier: 'destructive' })
      def.preview = async () => ({ summary: `delete **@everyone**\n<@123> \u202e${'x'.repeat(3000)}`, affected: {} })
      const elicit = vi.fn<(m: string) => Promise<'accept'>>(async () => 'accept')
      await runTool(deps, def, input, admin, { ...opts, elicit })
      const shown = elicit.mock.calls[0]![0] as string
      expect(shown).not.toMatch(/[*@<>\n\u202e]/)
      expect(shown.length).toBeLessThanOrEqual(1501)
    })

    it('preauthorized skips confirmation but still enforces tier', async () => {
      const handler = vi.fn(async () => ({ data: 'ok' }))
      const def = mk({ tier: 'destructive', handler })
      await expect(runTool(deps, def, { guild_id: G }, admin, { ...opts, preauthorized: true })).resolves.toEqual({ data: 'ok' })
      await expect(runTool(deps, def, { guild_id: H }, admin, { ...opts, preauthorized: true })).rejects.toMatchObject({ code: 'tier_exceeded' })
    })

    it('bulk limiter slot is taken only on execution, not previews or invalid tokens', async () => {
      build([], 1)
      const def = mk({ name: 'mod_bulk_ban', tier: 'destructive' })
      for (let i = 0; i < 3; i++) await runTool(deps, def, input, admin, opts).catch(() => undefined)
      await expect(runTool(deps, def, input, admin, { ...opts, elicit: accept })).resolves.toEqual({ data: 'done' })
      await expect(runTool(deps, def, input, admin, { ...opts, elicit: accept })).rejects.toMatchObject({ code: 'rate_limited' })
    })
  })

  describe('destructive (allow_token_confirm)', () => {
    beforeEach(() => build([], 100, true))

    it('without token returns preview and token, handler untouched', async () => {
      const handler = vi.fn(async () => ({ data: 'done' }))
      const def = mk({ tier: 'destructive', handler })
      await expect(runTool(deps, def, { guild_id: G, channel_id: C }, admin, opts)).rejects.toMatchObject({
        code: 'confirm_required',
        details: { preview: { summary: 'delete it' }, confirm_token: expect.any(String), expires_in_sec: 300 },
      })
      expect(handler).not.toHaveBeenCalled()
      expect(audits()[0]).toMatchObject({ outcome: 'dry_run', errorCode: 'confirm_required' })
    })

    const getToken = async (def: AnyToolDef, input: Record<string, unknown>, p: Principal = admin) => {
      const err = (await runTool(deps, def, input, p, opts).catch((e: unknown) => e)) as McpToolError
      return err.details.confirm_token as string
    }

    it('valid token executes once, replay fails', async () => {
      const handler = vi.fn(async () => ({ data: 'gone' }))
      const def = mk({ tier: 'destructive', handler })
      const input = { guild_id: G, channel_id: C }
      const confirm_token = await getToken(def, input)
      await expect(runTool(deps, def, { ...input, confirm_token }, admin, opts)).resolves.toEqual({ data: 'gone' })
      await expect(runTool(deps, def, { ...input, confirm_token }, admin, opts)).rejects.toMatchObject({ code: 'confirm_invalid' })
      expect(handler).toHaveBeenCalledTimes(1)
    })

    it('handler does not receive confirm_token', async () => {
      const handler = vi.fn(async (...args: [ToolContext, unknown]) => ({ data: args.length }))
      const def = mk({ tier: 'destructive', handler })
      const input = { guild_id: G, channel_id: C }
      const confirm_token = await getToken(def, input)
      await runTool(deps, def, { ...input, confirm_token }, admin, opts)
      expect(handler.mock.calls[0]![1]).toEqual(input)
    })

    it('token for a different input or principal is rejected; expired token rejected', async () => {
      const def = mk({ tier: 'destructive' })
      const t1 = await getToken(def, { guild_id: G, channel_id: C })
      await expect(runTool(deps, def, { guild_id: G, channel_id: D, confirm_token: t1 }, admin, opts)).rejects.toMatchObject({ code: 'confirm_invalid' })
      const t2 = await getToken(def, { guild_id: G }, stdio)
      await expect(runTool(deps, def, { guild_id: G, confirm_token: t2 }, admin, opts)).rejects.toMatchObject({ code: 'confirm_invalid' })
      const t3 = await getToken(def, { guild_id: G })
      clock += 300_001
      await expect(runTool(deps, def, { guild_id: G, confirm_token: t3 }, admin, opts)).rejects.toMatchObject({ code: 'confirm_invalid' })
    })

    it('unsupported or decline falls back to token flow only for unsupported', async () => {
      const def = mk({ tier: 'destructive' })
      await expect(runTool(deps, def, { guild_id: G }, admin, { ...opts, elicit: async () => 'unsupported' })).rejects.toMatchObject({
        code: 'confirm_required',
        details: { confirm_token: expect.any(String) },
      })
      await expect(runTool(deps, def, { guild_id: G }, admin, { ...opts, elicit: async () => 'decline' })).rejects.toMatchObject({
        code: 'confirm_required',
        details: { confirm_token: expect.any(String) },
      })
    })
  })

  describe('handler errors', () => {
    it('McpToolError propagates', async () => {
      const def = mk({ tier: 'write', handler: async () => { throw new McpToolError('not_found', 'nope') } })
      await expect(runTool(deps, def, { guild_id: G }, admin, opts)).rejects.toMatchObject({ code: 'not_found' })
      expect(audits()[0]).toMatchObject({ outcome: 'error', errorCode: 'not_found' })
    })

    it('other errors map to internal and are logged with correlation_id', async () => {
      const def = mk({ tier: 'write', handler: async () => { throw new Error('secret db path') } })
      const err = (await runTool(deps, def, { guild_id: G }, admin, opts).catch((e: unknown) => e)) as McpToolError
      expect(err).toMatchObject({ code: 'internal', message: 'internal error' })
      expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ correlation_id: 'corr-1' }), expect.any(String))
      expect(audits()[0]).toMatchObject({ outcome: 'error', errorCode: 'internal' })
    })
  })

  it('audit write failure does not turn a successful action into an error', async () => {
    deps.audit = { write: () => { throw new Error('disk full') } }
    const def = mk({ tier: 'write' })
    await expect(runTool(deps, def, { guild_id: G }, admin, opts)).resolves.toEqual({ data: 'done' })
    expect(log.error).toHaveBeenCalledWith(expect.objectContaining({ correlation_id: 'corr-1' }), 'audit write failed')
  })

  it('handler context always carries bound guards that enforce for user principals', async () => {
    let guards: ToolContext['guards'] | undefined
    const def = mk({ tier: 'write', handler: async (ctx) => { guards = ctx.guards; return { data: 1 } } })
    await runTool(deps, def, { guild_id: G }, admin, opts)
    expect(guards).toBeDefined()
    const limited: Principal = { kind: 'user', userId: 'x', userName: 'x', guilds: { [G]: PERM.MANAGE_GUILD.toString() } }
    await runTool(deps, def, { guild_id: G }, limited, opts)
    expect(() => guards!.assertCanGrantPermissions(G, PERM.ADMINISTRATOR)).toThrowError(expect.objectContaining({ code: 'missing_permissions' }))
    await runTool(deps, def, { guild_id: G }, stdio, opts)
    expect(() => guards!.assertCanGrantPermissions(G, PERM.ADMINISTRATOR)).not.toThrow()
  })

  it('partial results are audited as errors with code partial', async () => {
    const def = mk({ tier: 'write', handler: async () => ({ data: 1, partial: true }) })
    await runTool(deps, def, { guild_id: G }, admin, opts)
    expect(audits()[0]).toMatchObject({ outcome: 'error', errorCode: 'partial' })
  })

  it('writes exactly one audit row per call with actor, hash and latency', async () => {
    const def = mk({ tier: 'write', handler: async () => { clock += 42; return { data: 1 } } })
    await runTool(deps, def, { guild_id: G, channel_id: C }, admin, opts)
    const rows = audits()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      outcome: 'ok', tool: 'thing', tier: 'write', guildId: G, actor: 'alice', actorUserId: 'a', latencyMs: 42, errorCode: null,
    })
    expect(rows[0]!.inputHash).toMatch(/^[0-9a-f]{64}$/)
  })
})
