import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import express from 'express'
import type { Request, RequestHandler, Response, Router } from 'express'
import { randomUUID } from 'node:crypto'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
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

const handleMcp =
  (deps: ServerDeps) =>
  async (req: Request, res: Response): Promise<void> => {
    const principal = (req as PrincipalRequest).principal
    if (!principal) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }
    const server = createMcpServer(deps, () => principal)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      void transport.close()
      void server.close()
    })
    try {
      await server.connect(transport)
      await transport.handleRequest(req, res, req.body)
    } catch (err) {
      deps.logger.error({ error: err instanceof Error ? err.name : 'unknown' }, 'mcp http request failed')
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'internal error' }, id: null })
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
  const mcp = handleMcp(opts.deps)
  app.post('/mcp', mcp)
  app.get('/mcp', mcp)
  app.delete('/mcp', mcp)

  const server: Server = await new Promise((resolve, reject) => {
    const s = app.listen(opts.port, opts.host, () => resolve(s))
    s.once('error', reject)
  })
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
        server.closeAllConnections()
      }),
  }
}
