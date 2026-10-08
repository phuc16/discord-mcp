import { ConfigError, EX_CONFIG } from './errors.js'
import { loadDotEnv } from './env.js'
import { run } from './run.js'

const envError = loadDotEnv()
if (envError) {
  process.stderr.write(`${envError}\n`)
  process.exit(EX_CONFIG)
}

run(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exit(code)
  },
  (err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(err instanceof ConfigError ? EX_CONFIG : 1)
  },
)
