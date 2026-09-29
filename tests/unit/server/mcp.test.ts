import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { ResourceUpdatedNotificationSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import { McpToolError } from '../../../src/contracts/index.js'
import type { DiscordPort, NormalizedEvent, Principal, Services } from '../../../src/contracts/index.js'
import { createMcpServer } from '../../../src/server/mcp.js'
import type { RunToolFn, ServerDeps } from '../../../src/server/mcp.js'
import { buildToolRegistry } from '../../../src/server/registry.js'
import { fakeTool } from './helpers.js'

const G = '123456789012345678'
const principal: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }
const event = (id: number, guildId = G): NormalizedEvent => ({ id, guildId, type: 'message_create', at: 't', data: {} })

const setup = async (runTool: RunToolFn, opts: { feed?: boolean } = {}) => {
  const listeners = new Set<(e: NormalizedEvent) => void>()
  const poll = vi.fn(async () => [event(1)])
  const services = {
    events: { poll },
    policy: { effective: () => ({ guilds: { [G]: { maxTier: 'destructive', effectiveTier: 'destructive' } }, deniedTools: [] }) },
  } as unknown as Services
  const deps: ServerDeps = {
    registry: buildToolRegistry([fakeTool('t_read', 'read'), fakeTool('t_del', 'destructive')], []),
    discord: {} as DiscordPort,
    services,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
    runTool,
    eventFeed: opts.feed ? { subscribe: (cb) => (listeners.add(cb), () => listeners.delete(cb)) } : undefined,
  }
  const server = createMcpServer(deps, () => principal)
  const client = new Client({ name: 't', version: '1' })
  const [a, b] = InMemoryTransport.createLinkedPair()
  await Promise.all([server.connect(a), client.connect(b)])
  return { client, deps, listeners, poll }
}

const text = (r: unknown): unknown => JSON.parse((r as { content: { text: string }[] }).content[0]!.text)

describe('createMcpServer', () => {
  it('lists tools including confirm_token on destructive', async () => {
    const { client } = await setup(async () => ({ data: 1 }))
    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name).sort()).toEqual(['t_del', 't_read'])
    expect(tools.find((t) => t.name === 't_del')!.inputSchema.properties).toHaveProperty('confirm_token')
  })
  it('routes calls through runTool with principal', async () => {
    const runTool = vi.fn<RunToolFn>(async () => ({ data: { ok: true } }))
    const { client } = await setup(runTool)
    const r = await client.callTool({ name: 't_read', arguments: { guild_id: G } })
    expect(text(r)).toEqual({ ok: true })
    expect(runTool).toHaveBeenCalledOnce()
    expect(runTool.mock.calls[0]![0].name).toBe('t_read')
    expect(runTool.mock.calls[0]![2]).toEqual(principal)
    expect(runTool.mock.calls[0]![3].correlationId).toMatch(/[0-9a-f-]{36}/)
  })
  it('maps McpToolError to isError payload', async () => {
    const { client } = await setup(async () => {
      throw new McpToolError('not_found', 'nope', { id: 1 })
    })
    const r = await client.callTool({ name: 't_read', arguments: { guild_id: G } })
    expect(r.isError).toBe(true)
    expect(text(r)).toEqual({ error: { code: 'not_found', message: 'nope', details: { id: 1 } } })
  })
  it('maps confirm_required with preview and token', async () => {
    const { client } = await setup(async () => {
      throw new McpToolError('confirm_required', 'confirmation required', { preview: { summary: 's' }, confirm_token: 'tok' })
    })
    const r = await client.callTool({ name: 't_del', arguments: { guild_id: G } })
    expect(r.isError).toBe(true)
    expect(text(r)).toMatchObject({ error: { code: 'confirm_required', details: { preview: { summary: 's' }, confirm_token: 'tok' } } })
  })
  it('maps unknown errors to internal without stack', async () => {
    const { client, deps } = await setup(async () => {
      throw new Error('secret stack detail')
    })
    const r = await client.callTool({ name: 't_read', arguments: { guild_id: G } })
    expect(r.isError).toBe(true)
    expect(JSON.stringify(r)).not.toContain('secret')
    expect(text(r)).toEqual({ error: { code: 'internal', message: 'internal error', details: {} } })
    expect(deps.logger.error).toHaveBeenCalled()
  })
  it('elicit is unsupported when the client lacks the capability', async () => {
    let result: string | undefined
    const { client } = await setup(async (_d, _i, _p, o) => {
      result = await o.elicit!('m')
      return { data: 1 }
    })
    await client.callTool({ name: 't_read', arguments: { guild_id: G } })
    expect(result).toBe('unsupported')
  })
  it('lists and reads the events resource', async () => {
    const { client, poll } = await setup(async () => ({ data: 1 }))
    const list = await client.listResources()
    expect(list.resources.map((r) => r.uri)).toEqual([`discord://guild/${G}/events`])
    const read = await client.readResource({ uri: `discord://guild/${G}/events` })
    expect(JSON.parse((read.contents[0] as { text: string }).text)).toEqual([event(1)])
    expect(poll).toHaveBeenCalledWith(principal, { guildId: G, sinceId: 0, limit: 100 })
  })
  it('rejects reads and subscriptions for guilds outside policy', async () => {
    const { client } = await setup(async () => ({ data: 1 }))
    await expect(client.readResource({ uri: 'discord://guild/999999999999999999/events' })).rejects.toThrow()
    await expect(client.subscribeResource({ uri: 'discord://guild/999999999999999999/events' })).rejects.toThrow()
  })
  it('sends resources/updated to subscribers only', async () => {
    const { client, listeners } = await setup(async () => ({ data: 1 }), { feed: true })
    const updated: string[] = []
    client.setNotificationHandler(ResourceUpdatedNotificationSchema, async (n) => void updated.push(n.params.uri))
    for (const cb of listeners) cb(event(2))
    await new Promise((r) => setTimeout(r, 20))
    expect(updated).toEqual([])
    await client.subscribeResource({ uri: `discord://guild/${G}/events` })
    for (const cb of listeners) cb(event(3))
    for (const cb of listeners) cb(event(4, '999999999999999999'))
    await new Promise((r) => setTimeout(r, 20))
    expect(updated).toEqual([`discord://guild/${G}/events`])
    await client.unsubscribeResource({ uri: `discord://guild/${G}/events` })
    for (const cb of listeners) cb(event(5))
    await new Promise((r) => setTimeout(r, 20))
    expect(updated).toHaveLength(1)
    await client.close()
    expect(listeners.size).toBe(0)
  })
})
