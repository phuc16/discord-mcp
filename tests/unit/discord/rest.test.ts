import { describe, expect, it } from 'vitest'
import { McpToolError } from '../../../src/contracts/index.js'
import { createRest } from '../../../src/discord/rest.js'

interface Seen { url: string; method: string; headers: Record<string, string>; body: unknown }

const harness = (respond: () => Response) => {
  const seen: Seen[] = []
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init?.headers).entries())
    seen.push({ url: String(url), method: init?.method ?? 'GET', headers, body: init?.body })
    return respond()
  }) as typeof fetch
  return { seen, rest: createRest('tok-123', fetchImpl) }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

describe('createRest', () => {
  it('sends bot auth and query params', async () => {
    const { seen, rest } = harness(() => json([{ id: '1' }]))
    const out = await rest.get('/guilds/1/members', { query: { limit: 10, after: '5', skip: undefined } })
    expect(out).toEqual([{ id: '1' }])
    const call = seen[0]!
    expect(call.method).toBe('GET')
    expect(call.url).toBe('https://discord.com/api/v10/guilds/1/members?limit=10&after=5')
    expect(call.headers.authorization).toBe('Bot tok-123')
  })

  it('forwards reason as X-Audit-Log-Reason', async () => {
    const { seen, rest } = harness(() => json({ id: '2' }))
    await rest.patch('/channels/2', { body: { name: 'x' }, reason: 'because' })
    const call = seen[0]!
    expect(call.method).toBe('PATCH')
    expect(call.headers['x-audit-log-reason']).toBe('because')
    expect(JSON.parse(String(call.body))).toEqual({ name: 'x' })
  })

  it('omits authorization when auth is false', async () => {
    const { seen, rest } = harness(() => json({ id: '3' }))
    await rest.post('/webhooks/1/abc', { body: { content: 'hi' }, query: { wait: 'true' }, auth: false })
    expect(seen[0]!.headers.authorization).toBeUndefined()
  })

  it('supports put and delete verbs', async () => {
    const { seen, rest } = harness(() => new Response(null, { status: 204 }))
    await rest.put('/guilds/1/bans/2', { body: {} })
    await rest.delete('/guilds/1/bans/2')
    expect(seen.map((s) => s.method)).toEqual(['PUT', 'DELETE'])
  })

  it('maps discord failures without leaking the token', async () => {
    const { rest } = harness(() => json({ message: 'Unknown Channel', code: 10003 }, 404))
    const err = await rest.get('/channels/9').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(McpToolError)
    expect((err as McpToolError).code).toBe('not_found')
    expect(String((err as Error).message)).not.toContain('tok-123')
  })

  it('maps 403 to missing_permissions', async () => {
    const { rest } = harness(() => json({ message: 'Missing Permissions', code: 50013 }, 403))
    await expect(rest.delete('/channels/9')).rejects.toMatchObject({ code: 'missing_permissions' })
  })
})
