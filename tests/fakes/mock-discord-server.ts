import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

export interface MockUser {
  id: string
  username: string
  guilds: { id: string; permissions: string }[]
}

export interface MockDiscord {
  url: string
  close(): Promise<void>
}

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

const send = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

export const startMockDiscord = async (o: { users?: Record<string, MockUser> } = {}): Promise<MockDiscord> => {
  const users = o.users ?? {}
  const tokens = new Map<string, MockUser>()
  const usedCodes = new Set<string>()
  let issued = 0

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (req.method === 'POST' && url.pathname === '/oauth2/token') {
        const params = new URLSearchParams(await readBody(req))
        const code = params.get('code') ?? ''
        const user = users[code]
        if (!user || usedCodes.has(code)) return send(res, 400, { error: 'invalid_grant' })
        usedCodes.add(code)
        issued += 1
        const token = `mock-access-${issued}-${code}`
        tokens.set(token, user)
        return send(res, 200, { access_token: token, token_type: 'Bearer', expires_in: 604800, scope: 'identify guilds' })
      }
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1]
      const user = bearer ? tokens.get(bearer) : undefined
      if (req.method === 'GET' && url.pathname === '/users/@me') {
        return user ? send(res, 200, { id: user.id, username: user.username }) : send(res, 401, { message: '401: Unauthorized' })
      }
      if (req.method === 'GET' && url.pathname === '/users/@me/guilds') {
        return user ? send(res, 200, user.guilds) : send(res, 401, { message: '401: Unauthorized' })
      }
      send(res, 404, { message: 'Not Found' })
    })()
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
        server.closeAllConnections()
      }),
  }
}
