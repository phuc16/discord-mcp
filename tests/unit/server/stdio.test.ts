import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { DiscordPort, Services } from '../../../src/contracts/index.js'
import type { RunToolFn, ServerDeps } from '../../../src/server/mcp.js'
import { buildToolRegistry } from '../../../src/server/registry.js'
import { fakeTool } from './helpers.js'

const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()
const serverSideOverride: { current?: unknown } = {}

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class { constructor() { return serverSideOverride.current ?? serverSide } } }))

describe('startStdio', () => {
  it('serves tools as the stdio principal', async () => {
    const { startStdio, STDIO_PRINCIPAL } = await import('../../../src/server/stdio.js')
    const runTool = vi.fn<RunToolFn>(async () => ({ data: { ok: true } }))
    const deps: ServerDeps = {
      registry: buildToolRegistry([fakeTool('t_read', 'read')], []),
      discord: {} as DiscordPort,
      services: {} as Services,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      runTool,
      recentEvents: () => [],
    }
    const handle = await startStdio(deps)
    const client = new Client({ name: 't', version: '1' })
    await client.connect(clientSide)
    await client.callTool({ name: 't_read', arguments: { guild_id: '1' } })
    expect(runTool.mock.calls[0]![2]).toEqual(STDIO_PRINCIPAL)
    expect(STDIO_PRINCIPAL.kind).toBe('stdio')
    await handle.close()
  })
  it('signals once when stdin ends or closes', async () => {
    const { startStdio } = await import('../../../src/server/stdio.js')
    const deps = {
      registry: buildToolRegistry([], []),
      discord: {} as DiscordPort,
      services: {} as Services,
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
      runTool: vi.fn<RunToolFn>(),
      recentEvents: () => [],
    } satisfies ServerDeps
    const stdin = new EventEmitter()
    const onEnd = vi.fn()
    const [a] = InMemoryTransport.createLinkedPair()
    serverSideOverride.current = a
    const handle = await startStdio(deps, { stdin, onEnd })
    stdin.emit('end')
    stdin.emit('close')
    expect(onEnd).toHaveBeenCalledTimes(1)
    await handle.close()
  })
})
