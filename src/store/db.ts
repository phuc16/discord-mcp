import Database from 'better-sqlite3'
import { migrations } from './migrations.js'

export type Db = Database.Database

export const openDb = (path: string): Db => {
  const db = new Database(path)
  if (path !== ':memory:') db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export const schemaVersion = (db: Db): number => {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as { value: string } | undefined
  return row ? Number(row.value) : 0
}

const migrate = (db: Db): void => {
  db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
  const current = schemaVersion(db)
  for (const m of migrations) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.exec(m.sql)
      db.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(m.version))
    })()
  }
}
