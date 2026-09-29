import { McpToolError, tierRank } from '../contracts/index.js'
import type { AnyToolDef, DiscordPort, ErrorCode, Logger, Principal, PreviewResult, Services, ToolContext, ToolResult } from '../contracts/index.js'
import type { AuditWriter } from './audit.js'
import { hashInput } from './confirm.js'
import type { ConfirmService } from './confirm.js'
import type { BulkLimiter } from './limiter.js'
import type { PolicyEngine } from './policy.js'

export interface PipelineDeps {
  policy: PolicyEngine
  confirm: ConfirmService
  audit: AuditWriter
  limiter: BulkLimiter
  now?: () => number
}

export interface RunOptions {
  discord: DiscordPort
  services: Services
  logger: Logger
  correlationId: string
  elicit?: (message: string) => Promise<'accept' | 'decline' | 'unsupported'>
  preauthorized?: boolean
}

const BULK_TOOLS: ReadonlySet<string> = new Set(['messages_purge', 'roles_bulk_assign', 'mod_bulk_ban', 'guild_prune'])
const DENIED_CODES: ReadonlySet<ErrorCode> = new Set(['guild_not_allowed', 'tier_exceeded', 'unauthorized', 'confirm_invalid'])
const CONFIRM_TTL_SEC = 300

export const runTool = async (
  deps: PipelineDeps,
  def: AnyToolDef,
  rawInput: unknown,
  principal: Principal,
  opts: RunOptions,
): Promise<ToolResult> => {
  const now = deps.now ?? Date.now
  const started = now()
  let guildId: string | null = null
  let inputForHash: unknown = rawInput
  let dryRun = false

  const record = (outcome: 'ok' | 'dry_run' | 'denied' | 'error', errorCode: string | null): void => {
    deps.audit.write({
      at: new Date(now()).toISOString(),
      correlationId: opts.correlationId,
      tool: def.name,
      tier: def.tier,
      guildId,
      actor: principal.userName,
      actorUserId: principal.userId,
      inputHash: hashInput(inputForHash),
      outcome,
      errorCode,
      latencyMs: now() - started,
    })
  }

  try {
    if (deps.policy.toolDenied(def.name)) throw new McpToolError('tier_exceeded', 'tool disabled by policy')

    const parsed = def.input.safeParse(rawInput)
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
      throw new McpToolError('invalid_input', 'invalid input', { issues })
    }
    const { confirm_token: parsedToken, ...input } = parsed.data as Record<string, unknown>
    const rawToken = rawInput !== null && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>).confirm_token : undefined
    const confirmToken = typeof rawToken === 'string' ? rawToken : typeof parsedToken === 'string' ? parsedToken : undefined
    inputForHash = input

    guildId = def.guildFrom(input)
    if (guildId === null) {
      if (def.tier !== 'read') throw new McpToolError('guild_not_allowed', 'guild_id is required')
    } else {
      if (!deps.policy.guildAllowed(guildId)) throw new McpToolError('guild_not_allowed', 'guild not allowed')
      const effective = deps.policy.effectiveTier(principal, guildId, def.group)
      if (effective === null) throw new McpToolError('guild_not_allowed', 'guild not accessible')
      if (tierRank[def.tier] > tierRank[effective]) {
        throw new McpToolError('tier_exceeded', 'tier exceeded', { required: def.tier, effective })
      }
      if (BULK_TOOLS.has(def.name)) {
        const taken = deps.limiter.take(guildId)
        if (!taken.ok) throw new McpToolError('rate_limited', 'bulk rate limit exceeded', { retry_after: taken.retryAfterSec })
      }
    }

    const ctx: ToolContext = {
      discord: opts.discord,
      principal,
      correlationId: opts.correlationId,
      logger: opts.logger,
      services: opts.services,
    }

    const runPreview = async (): Promise<PreviewResult> => {
      if (!def.preview) throw new Error(`destructive tool ${def.name} has no preview`)
      return def.preview(ctx, input)
    }

    const execute = async (): Promise<ToolResult> => {
      try {
        return await def.handler(ctx, input)
      } catch (e) {
        if (e instanceof McpToolError) throw e
        opts.logger.error({ correlation_id: opts.correlationId, tool: def.name, err: e instanceof Error ? e.message : String(e) }, 'tool handler failed')
        throw new McpToolError('internal', 'internal error')
      }
    }

    if (def.tier === 'destructive' && !opts.preauthorized) {
      if (confirmToken !== undefined) {
        const verdict = deps.confirm.verify(def.name, input, principal, confirmToken)
        if (verdict !== 'ok') throw new McpToolError('confirm_invalid', `confirm token ${verdict}`)
      } else {
        let proceed = false
        if (opts.elicit) {
          const preview = await runPreview()
          const answer = await opts.elicit(preview.summary)
          if (answer === 'decline') throw new McpToolError('confirm_invalid', 'declined by user')
          proceed = answer === 'accept'
        }
        if (!proceed) {
          const preview = await runPreview()
          const { token } = deps.confirm.issue(def.name, input, principal)
          dryRun = true
          throw new McpToolError('confirm_required', 'confirmation required', {
            preview,
            confirm_token: token,
            expires_in_sec: CONFIRM_TTL_SEC,
          })
        }
      }
    }

    const result = await execute()
    record('ok', null)
    return result
  } catch (e) {
    if (e instanceof McpToolError) {
      record(dryRun ? 'dry_run' : DENIED_CODES.has(e.code) ? 'denied' : 'error', e.code)
      throw e
    }
    opts.logger.error({ correlation_id: opts.correlationId, tool: def.name, err: e instanceof Error ? e.message : String(e) }, 'pipeline failed')
    record('error', 'internal')
    throw new McpToolError('internal', 'internal error')
  }
}
