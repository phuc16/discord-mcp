import { accessSync, constants } from 'node:fs'
import { dirname } from 'node:path'

export const EX_CONFIG = 78

export class ConfigError extends Error {
  readonly exitCode = EX_CONFIG
}

export const currentUid = (): string => String(process.getuid?.() ?? 'unknown')

export const checkWritableDir = (dbPath: string): void => {
  if (dbPath === ':memory:') return
  const dir = dirname(dbPath)
  try {
    accessSync(dir, constants.W_OK)
  } catch (err) {
    const why = (err as NodeJS.ErrnoException).code === 'ENOENT' ? 'does not exist' : 'is not writable'
    throw new ConfigError(
      `database directory ${dir} ${why} for the current user (uid ${currentUid()}); the database is ${dbPath}. In Docker run: chown 1000:1000 <host data dir>`,
    )
  }
}
