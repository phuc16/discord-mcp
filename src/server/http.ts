import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import express from 'express'
import type { Request, RequestHandler, Response, Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { principalKey } from '../contracts/index.js'
import type { Principal } from '../contracts/index.js'
import { createMcpServer } from './mcp.js'
import type { ServerDeps } from './mcp.js'

export interface HttpOptions {
  deps: ServerDeps
  host: string
  port: number
  bearer: RequestHandler
  authRouter?: Router
  health: () => { gateway: string; db: string }
  maxSessions?: number
  idleTtlMs?: number
  sweepIntervalMs?: number
  now?: () => number
}

export interface HttpHandle {
  close(): Promise<void>
  port: number
}

type PrincipalRequest = Request & { principal?: Principal }

const accessLog =
  (deps: ServerDeps): RequestHandler =>
  (req, res, next) => {
    const started = process.hrtime.bigint()
    const requestId = randomUUID()
    res.setHeader('x-request-id', requestId)
    res.on('finish', () => {
      deps.logger.info(
        {
          request_id: requestId,
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ip: req.ip,
          latency: Number((process.hrtime.bigint() - started) / 1_000_000n),
          user_name: (req as PrincipalRequest).principal?.userName,
        },
        'http request',
      )
    })
    next()
  }

interface Session {
  transport: StreamableHTTPServerTransport
  server: McpServer
  ownerKey: string
  principal: Principal
  lastUsed: number
}

const DEFAULT_MAX_SESSIONS = 100
const DEFAULT_IDLE_TTL_MS = 30 * 60 * 1000

const rpcError = (res: Response, status: number, message: string): void => {
  res.status(status).json({ jsonrpc: '2.0', error: { code: -32000, message }, id: null })
}

const createSessionHandler = (deps: ServerDeps, sessions: Map<string, Session>, maxSessions: number, now: () => number) =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = (req as PrincipalRequest).principal
    if (!principal) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const sid = req.header('mcp-session-id')
    try {
      if (sid) {
        const session = sessions.get(sid)
        if (!session || session.ownerKey !== principalKey(principal)) {
          rpcError(res, 404, 'session not found')
          return
        }
        session.lastUsed = now()
        session.principal = principal
        await session.transport.handleRequest(req, res, req.body)
        return
      }
      if (req.method !== 'POST' || !isInitializeRequest(req.body)) {
        rpcError(res, 400, 'missing mcp-session-id')
        return
      }
      if (sessions.size >= maxSessions) {
        rpcError(res, 503, 'too many sessions')
        return
      }
      const holder: { session?: Session } = {}
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: randomUUID,
        onsessioninitialized: (id) => {
          if (holder.session) sessions.set(id, holder.session)
        },
      })
      const server = createMcpServer(deps, () => holder.session?.principal ?? principal)
      holder.session = { transport, server, ownerKey: principalKey(principal), principal, lastUsed: now() }
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId)
        void server.close()
      }
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      deps.logger.error({ error: err instanceof Error ? err.name : 'unknown' }, 'mcp http request failed')
      if (!res.headersSent) rpcError(res, 500, 'internal error')
    }
  }

export const startHttp = async (opts: HttpOptions): Promise<HttpHandle> => {
  const app = express()
  app.set('trust proxy', true)
  app.use(accessLog(opts.deps))
  app.get('/healthz', (_req, res) => {
    res.json({ status: 'ok', ...opts.health() })
  })
  if (opts.authRouter) app.use(opts.authRouter)
  app.use('/mcp', opts.bearer, express.json({ limit: '4mb' }))
  const sessions = new Map<string, Session>()
  const now = opts.now ?? Date.now
  const idleTtlMs = opts.idleTtlMs ?? DEFAULT_IDLE_TTL_MS
  const mcp = createSessionHandler(opts.deps, sessions, opts.maxSessions ?? DEFAULT_MAX_SESSIONS, now)
  app.post('/mcp', mcp)
  app.get('/mcp', mcp)
  app.delete('/mcp', mcp)

  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(opts.port, opts.host, () => resolve(s))
    s.once('error', reject)
  })
  const sweep = setInterval(() => {
    for (const session of [...sessions.values()]) {
      if (now() - session.lastUsed > idleTtlMs) void session.transport.close()
    }
  }, opts.sweepIntervalMs ?? 60_000)
  sweep.unref()
  return {
    port: (server.address() as AddressInfo).port,
    close: async () => {
      clearInterval(sweep)
      await Promise.all([...sessions.values()].map((session) => session.transport.close()))
      await new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        server.closeAllConnections()
      })
    },
  }
}
