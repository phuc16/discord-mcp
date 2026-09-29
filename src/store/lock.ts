import { closeSync, openSync, readFileSync, unlinkSync, writeSync } from 'node:fs'

const held = new Set<string>()

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const inUse = (path: string, pid: number | null): Error =>
  new Error(`database ${path} is already in use${pid ? ` by process ${pid}` : ''}; stop the other discord-mcp instance or point database_path elsewhere`)

const tryCreate = (lockPath: string): boolean => {
  try {
    const fd = openSync(lockPath, 'wx')
    writeSync(fd, String(process.pid))
    closeSync(fd)
    return true
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return false
    throw err
  }
}

export const acquireLock = (dbPath: string): (() => void) => {
  const lockPath = `${dbPath}.lock`
  if (held.has(lockPath)) throw inUse(dbPath, process.pid)
  if (!tryCreate(lockPath)) {
    const pid = Number(readFileSync(lockPath, 'utf8').trim()) || null
    if (pid !== null && pid !== process.pid && alive(pid)) throw inUse(dbPath, pid)
    unlinkSync(lockPath)
    if (!tryCreate(lockPath)) throw inUse(dbPath, null)
  }
  held.add(lockPath)
  return () => {
    held.delete(lockPath)
    try {
      unlinkSync(lockPath)
    } catch {
      return
    }
  }
}
