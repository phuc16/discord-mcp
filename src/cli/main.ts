import { loadDotEnv } from './env.js'
import { run } from './run.js'

const envError = loadDotEnv()
if (envError) {
  process.stderr.write(`${envError}\n`)
  process.exit(1)
}

run(process.argv.slice(2)).then(
  (code) => {
    if (code !== 0) process.exit(code)
  },
  (err: unknown) => {
    process.stderr.write(`${(err as Error).message}\n`)
    process.exit(1)
  },
)
