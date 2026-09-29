import { DiscordAPIError, RateLimitError } from 'discord.js'
import { McpToolError } from '../contracts/index.js'

const isNotFoundCode = (code: unknown): boolean => typeof code === 'number' && code >= 10000 && code < 11000

export const mapDiscordError = (err: unknown): McpToolError => {
  if (err instanceof McpToolError) return err
  if (err instanceof RateLimitError) {
    return new McpToolError('rate_limited', 'rate limited by Discord', { retry_after: err.retryAfter / 1000 })
  }
  if (err instanceof DiscordAPIError) {
    const code = typeof err.code === 'number' ? err.code : undefined
    if (err.status === 404 || isNotFoundCode(code)) return new McpToolError('not_found', 'resource not found')
    if (err.status === 403 || code === 50001 || code === 50013) {
      return new McpToolError('missing_permissions', 'bot lacks permission for this action')
    }
    if (err.status === 429) return new McpToolError('rate_limited', 'rate limited by Discord')
    if (err.status === 400) return new McpToolError('invalid_input', err.message)
  }
  return new McpToolError('internal', 'internal error')
}
