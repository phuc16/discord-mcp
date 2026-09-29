import { Writable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import { createLogger } from '../../../src/cli/logger.js'

const capture = () => {
  const lines: string[] = []
  const destination = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk))
      cb()
    },
  })
  return { lines, destination }
}

describe('createLogger', () => {
  it('emits underscore fields and iso timestamp', () => {
    const { lines, destination } = capture()
    createLogger({ destination }).info({ correlation_id: 'c1', latency: 3 }, 'hello')
    const rec = JSON.parse(lines[0] ?? '{}')
    expect(rec).toMatchObject({ correlation_id: 'c1', latency: 3, msg: 'hello' })
    expect(rec.time).toMatch(/^\d{4}-\d\d-\d\dT/)
  })
  it('redacts secrets', () => {
    const { lines, destination } = capture()
    const log = createLogger({ destination })
    log.info({ token: 'SECRET1', auth: { access_token: 'SECRET2', client_secret: 'SECRET3' }, authorization: 'Bearer SECRET4', bot_token: 'SECRET5', a: { refresh_token: 'SECRET6' } })
    const out = lines.join('')
    expect(out).not.toMatch(/SECRET/)
  })
  it('respects level', () => {
    const { lines, destination } = capture()
    createLogger({ level: 'error', destination }).info({}, 'x')
    expect(lines).toHaveLength(0)
  })
})
