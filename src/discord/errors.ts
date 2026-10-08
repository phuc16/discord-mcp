import { DiscordAPIError, RateLimitError } from 'discord.js'
import { McpToolError } from '../contracts/index.js'

const isNotFoundCode = (code: unknown): boolean => typeof code === 'number' && code >= 10000 && code < 11000
const FAILED_TO_BAN_USERS = 500000

export interface ErrorLogger {
  error(o: Record<string, unknown>): void
}

const stderrLogger: ErrorLogger = {
  error: (o) => process.stderr.write(`${JSON.stringify({ level: 'error', msg: 'discord api error', ...o })}\n`),
}

const retryAfterOf = (err: DiscordAPIError): number | undefined => {
  const raw = err.rawError as { retry_after?: unknown } | undefined
  return typeof raw?.retry_after === 'number' ? raw.retry_after : undefined
}

export const mapDiscordError = (err: unknown, log: ErrorLogger = stderrLogger): McpToolError => {
  if (err instanceof McpToolError) return err
  if (err instanceof RateLimitError) {
    return new McpToolError('rate_limited', 'rate limited by Discord', { retry_after: err.retryAfter / 1000 })
  }
  if (err instanceof DiscordAPIError) {
    const code = typeof err.code === 'number' ? err.code : undefined
    if (code === FAILED_TO_BAN_USERS) {
      return new McpToolError('invalid_input', 'no users could be banned (already banned, not bannable, or above the bot in the role hierarchy)')
    }
    if (err.status === 404 || isNotFoundCode(code)) return new McpToolError('not_found', 'resource not found')
    if (err.status === 401) {
      log.error({ status: 401, path: err.url, error: 'bot token rejected by discord' })
      return new McpToolError('internal', 'internal error')
    }
    if (err.status === 403 || code === 50001 || code === 50013) {
      return new McpToolError('missing_permissions', 'bot lacks permission for this action')
    }
    if (err.status === 429) {
      const retryAfter = retryAfterOf(err)
      return new McpToolError('rate_limited', 'rate limited by Discord', retryAfter === undefined ? {} : { retry_after: retryAfter })
    }
    if (err.status === 400) return new McpToolError('invalid_input', err.message)
    if (err.status >= 500) return new McpToolError('internal', 'discord service error', { status: err.status })
  }
  return new McpToolError('internal', 'internal error')
}
