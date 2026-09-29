import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { Principal } from '../contracts/index.js'
import { createMcpServer } from './mcp.js'
import type { ServerDeps } from './mcp.js'

export const STDIO_PRINCIPAL: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }

export const startStdio = async (deps: ServerDeps): Promise<{ close(): Promise<void> }> => {
  const server = createMcpServer(deps, () => STDIO_PRINCIPAL)
  await server.connect(new StdioServerTransport())
  return { close: () => server.close() }
}
