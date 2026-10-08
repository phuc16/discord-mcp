import type { NormalizedEvent } from '../contracts/index.js'
import { readPath } from './match.js'

const PLACEHOLDER = /\{\{\s*([^{}]*?)\s*\}\}/g
const WHOLE = /^\{\{\s*([^{}]*?)\s*\}\}$/

const resolve = (path: string, e: NormalizedEvent): unknown => {
  if (!path.startsWith('event.')) return undefined
  const rest = path.slice('event.'.length)
  return readPath(e, rest === 'guild_id' ? 'guildId' : rest)
}

const need = (path: string, e: NormalizedEvent): unknown => {
  const v = resolve(path, e)
  if (v === undefined) throw new Error(`template: missing ${path}`)
  return v
}

const renderValue = (v: unknown, e: NormalizedEvent): unknown => {
  if (typeof v === 'string') {
    const whole = WHOLE.exec(v)
    if (whole) return need(whole[1]!, e)
    return v.replace(PLACEHOLDER, (_m, path: string) => {
      const r = need(path, e)
      return typeof r === 'object' && r !== null ? JSON.stringify(r) : String(r)
    })
  }
  if (Array.isArray(v)) return v.map((x) => renderValue(x, e))
  if (v !== null && typeof v === 'object') return renderTemplate(v as Record<string, unknown>, e)
  return v
}

export const renderTemplate = (template: Record<string, unknown>, e: NormalizedEvent): Record<string, unknown> =>
  Object.fromEntries(Object.entries(template).map(([k, v]) => [k, renderValue(v, e)]))

export const templateReferences = (v: unknown): string[] => {
  if (typeof v === 'string') return [...v.matchAll(PLACEHOLDER)].map((m) => m[1]!)
  if (Array.isArray(v)) return v.flatMap(templateReferences)
  if (v !== null && typeof v === 'object') return Object.values(v).flatMap(templateReferences)
  return []
}
