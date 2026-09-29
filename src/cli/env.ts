import { existsSync } from 'node:fs'

export const loadDotEnv = (path = '.env'): string | null => {
  if (!existsSync(path)) return null
  try {
    process.loadEnvFile(path)
    return null
  } catch (err) {
    return `cannot load ${path}: ${(err as NodeJS.ErrnoException).code ?? (err as Error).message}`
  }
}
