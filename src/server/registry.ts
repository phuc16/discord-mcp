import { z } from 'zod'
import type { AnyToolDef } from '../contracts/index.js'

export const buildToolRegistry = (defs: AnyToolDef[], denied: string[]): Map<string, AnyToolDef> => {
  const seen = new Set<string>()
  for (const def of defs) {
    if (seen.has(def.name)) throw new Error(`duplicate tool name: ${def.name}`)
    seen.add(def.name)
  }
  const deniedSet = new Set(denied)
  const registry = new Map<string, AnyToolDef>()
  for (const def of defs) {
    if (deniedSet.has(def.name)) continue
    registry.set(def.name, def.tier === 'destructive' ? { ...def, input: def.input.extend({ confirm_token: z.string().optional() }) } : def)
  }
  return registry
}
