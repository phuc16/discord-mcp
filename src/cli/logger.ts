import pino from 'pino'
import type { Logger } from '../contracts/index.js'

const REDACT = ['token', 'access_token', 'refresh_token', 'client_secret', 'authorization', 'bot_token', 'confirm_token', '*.token', '*.access_token', '*.refresh_token', '*.client_secret', '*.authorization', '*.bot_token', '*.confirm_token']

export const createLogger = (opts: { level?: string; destination?: NodeJS.WritableStream }): Logger =>
  pino(
    {
      level: opts.level ?? 'info',
      base: null,
      timestamp: pino.stdTimeFunctions.isoTime,
      redact: { paths: REDACT, censor: '[redacted]' },
    },
    opts.destination ?? process.stderr,
  ) as unknown as Logger
