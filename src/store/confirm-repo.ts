import type { Db } from './db.js'

export interface ConfirmRepo {
  create(c: { tokenHash: string; inputHash: string; principalKey: string; tool: string; expiresAt: number }): void
  consume(c: { tokenHash: string; inputHash: string; principalKey: string; tool: string; now: number }): 'ok' | 'invalid' | 'expired'
}

interface Row {
  input_hash: string
  principal_key: string
  tool: string
  expires_at: number
  used: number
}

export const createConfirmRepo = (db: Db): ConfirmRepo => {
  const insert = db.prepare(
    'INSERT INTO confirmations (token_hash, input_hash, principal_key, tool, expires_at) VALUES (@tokenHash, @inputHash, @principalKey, @tool, @expiresAt)',
  )
  const select = db.prepare('SELECT input_hash, principal_key, tool, expires_at, used FROM confirmations WHERE token_hash = ?')
  const markUsed = db.prepare('UPDATE confirmations SET used = 1 WHERE token_hash = ? AND used = 0')
  const consume = db.transaction((c: Parameters<ConfirmRepo['consume']>[0]): 'ok' | 'invalid' | 'expired' => {
    const row = select.get(c.tokenHash) as Row | undefined
    if (!row || row.used) return 'invalid'
    if (row.input_hash !== c.inputHash || row.principal_key !== c.principalKey || row.tool !== c.tool) return 'invalid'
    if (row.expires_at <= c.now) return 'expired'
    return markUsed.run(c.tokenHash).changes === 1 ? 'ok' : 'invalid'
  })
  return {
    create: (c) => void insert.run(c),
    consume: (c) => consume(c),
  }
}
