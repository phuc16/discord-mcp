import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { ConfigSchema } from '../contracts/index.js'
import type { Config } from '../contracts/index.js'

export const loadConfig = (path: string): Config => {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch (err) {
    throw new Error(`cannot read config file ${path}: ${(err as NodeJS.ErrnoException).code ?? 'error'}`)
  }
  let raw: unknown
  try {
    raw = parse(text)
  } catch (err) {
    throw new Error(`invalid YAML in ${path}: ${(err as Error).message}`)
  }
  const result = ConfigSchema.safeParse(raw ?? {})
  if (!result.success) {
    const lines = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`invalid config ${path}:\n${lines.join('\n')}`)
  }
  return result.data
}
