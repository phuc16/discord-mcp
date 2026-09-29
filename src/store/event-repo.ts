import type { EventType, NewEvent, NormalizedEvent } from '../contracts/index.js'
import type { Db } from './db.js'

export interface EventRepo {
  append(e: NewEvent): NormalizedEvent
  since(q: { guildId: string; sinceId: number; types?: EventType[]; limit: number }): NormalizedEvent[]
  prune(o: { olderThanIso: string; maxRows: number }): number
  latestId(): number
}

interface Row {
  id: number
  guild_id: string
  type: EventType
  at: string
  data: string
}

const toEvent = (r: Row): NormalizedEvent => ({ id: r.id, guildId: r.guild_id, type: r.type, at: r.at, data: JSON.parse(r.data) })

export const createEventRepo = (db: Db): EventRepo => {
  const insert = db.prepare('INSERT INTO events (guild_id, type, at, data) VALUES (?, ?, ?, ?)')
  const dropOld = db.prepare('DELETE FROM events WHERE at < ?')
  const trim = db.prepare('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)')
  const latest = db.prepare('SELECT COALESCE(MAX(id), 0) AS id FROM events')
  const prune = db.transaction((o: { olderThanIso: string; maxRows: number }) => dropOld.run(o.olderThanIso).changes + trim.run(o.maxRows).changes)
  return {
    append(e) {
      const info = insert.run(e.guildId, e.type, e.at, JSON.stringify(e.data))
      return { id: Number(info.lastInsertRowid), ...e }
    },
    since(q) {
      const types = q.types?.length ? q.types : undefined
      const marks = types ? ` AND type IN (${types.map(() => '?').join(',')})` : ''
      const sql = `SELECT * FROM events WHERE guild_id = ? AND id > ?${marks} ORDER BY id ASC LIMIT ?`
      return (db.prepare(sql).all(q.guildId, q.sinceId, ...(types ?? []), q.limit) as Row[]).map(toEvent)
    },
    prune: (o) => prune(o),
    latestId: () => (latest.get() as { id: number }).id,
  }
}
