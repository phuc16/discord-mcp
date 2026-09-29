import { existsSync } from 'node:fs'
import { run } from './run.js'

if (existsSync('.env')) process.loadEnvFile('.env')

run(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exit(code)
  },
  (err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(1)
  },
)
