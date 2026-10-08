import { createHash, randomBytes } from 'node:crypto'

export const newToken = (): string => randomBytes(32).toString('base64url')

export const hashSecret = (s: string): string => createHash('sha256').update(s).digest('hex')
