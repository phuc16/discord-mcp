import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { describe, expect, it, vi } from 'vitest'
import type { DiscordPort, Services } from '../../../src/contracts/index.js'
import type { RunToolFn, ServerDeps } from '../../../src/server/mcp.js'
import { buildToolRegistry } from '../../../src/server/registry.js'
import { fakeTool } from './helpers.js'

const [serverSide, clientSide] = InMemoryTransport.createLinkedPair()

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: class { constructor() { return serverSide } } }))

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
    }
    const handle = await startStdio(deps)
    const client = new Client({ name: 't', version: '1' })
    await client.connect(clientSide)
    await client.callTool({ name: 't_read', arguments: { guild_id: '1' } })
    expect(runTool.mock.calls[0]![2]).toEqual(STDIO_PRINCIPAL)
    expect(STDIO_PRINCIPAL.kind).toBe('stdio')
    await handle.close()
  })
})
