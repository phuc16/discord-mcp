import { DiscordAPIError, RateLimitError } from 'discord.js'
import { describe, expect, it } from 'vitest'
import { McpToolError } from '../../../src/contracts/index.js'
import { mapDiscordError } from '../../../src/discord/errors.js'

const api = (status: number, code: number, message = 'msg') =>
  new DiscordAPIError({ message, code }, code, status, 'GET', 'https://discord.com/api/v10/x', {})

describe('mapDiscordError', () => {
  it('maps 404 to not_found', () => {
    expect(mapDiscordError(api(404, 10003)).code).toBe('not_found')
  })
  it('maps 10xxx code to not_found regardless of status', () => {
    expect(mapDiscordError(api(400, 10013)).code).toBe('not_found')
  })
  it('maps 403 to missing_permissions', () => {
    expect(mapDiscordError(api(403, 50013)).code).toBe('missing_permissions')
  })
  it('maps code 50001 to missing_permissions', () => {
    expect(mapDiscordError(api(400, 50001)).code).toBe('missing_permissions')
  })
  it('maps 400 to invalid_input with discord message', () => {
    const e = mapDiscordError(api(400, 50035, 'Invalid Form Body'))
    expect(e.code).toBe('invalid_input')
    expect(e.message).toBe('Invalid Form Body')
  })
  it('maps RateLimitError to rate_limited with retry_after seconds', () => {
    const rl = new RateLimitError({
      timeToReset: 2500, limit: 5, method: 'POST', hash: 'h', url: 'u', route: 'r',
      majorParameter: 'm', global: false, retryAfter: 2500, sublimit: false, scope: 'user',
    } as never)
    const e = mapDiscordError(rl)
    expect(e.code).toBe('rate_limited')
    expect(e.details.retry_after).toBe(2.5)
  })
  it('maps 429 DiscordAPIError to rate_limited', () => {
    expect(mapDiscordError(api(429, 0)).code).toBe('rate_limited')
  })
  it('maps unknown errors to internal without leaking', () => {
    const e = mapDiscordError(new Error('boom Bot secret-token'))
    expect(e.code).toBe('internal')
    expect(e.message).toBe('internal error')
  })
  it('passes McpToolError through', () => {
    const orig = new McpToolError('unauthorized', 'x')
    expect(mapDiscordError(orig)).toBe(orig)
  })
})
