import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { EventEmitter } from 'node:events'
import type { Principal } from '../contracts/index.js'
import { createMcpServer } from './mcp.js'
import type { ServerDeps } from './mcp.js'

export const STDIO_PRINCIPAL: Principal = { kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }

export interface StdioOptions {
  stdin?: EventEmitter
  onEnd?: () => void
}

export const startStdio = async (deps: ServerDeps, opts: StdioOptions = {}): Promise<{ close(): Promise<void> }> => {
  const stdin = opts.stdin ?? process.stdin
  const server = createMcpServer(deps, () => STDIO_PRINCIPAL)
  await server.connect(new StdioServerTransport())
  let ended = false
  const end = (): void => {
    if (ended) return
    ended = true
    opts.onEnd?.()
  }
  stdin.on('end', end)
  stdin.on('close', end)
  return {
    close: () => {
      stdin.off('end', end)
      stdin.off('close', end)
      return server.close()
    },
  }
}
