import { canonicalJson } from '../contracts/index.js'
import type { Condition, NormalizedEvent, Rule } from '../contracts/index.js'

const MAX_PATTERN = 200
const MAX_INPUT = 2000
const MAX_REGEX_MS = 50
const DAY_MS = 86_400_000
const NESTED_QUANTIFIER = /\([^)]*(?:[+*]|\{\d*,?\d*\})[^)]*\)(?:[+*]|\{\d*,?\d*\})/

export const readPath = (root: unknown, path: string): unknown => {
  let cur: unknown = root
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

const same = (a: unknown, b: unknown): boolean => a !== undefined && canonicalJson(a) === canonicalJson(b)

const safeRegexTest = (pattern: string, input: string): boolean => {
  if (pattern.length > MAX_PATTERN || NESTED_QUANTIFIER.test(pattern)) return false
  try {
    const re = new RegExp(pattern)
    const started = performance.now()
    const hit = re.test(input.slice(0, MAX_INPUT))
    return performance.now() - started <= MAX_REGEX_MS && hit
  } catch {
    return false
  }
}

const conditionHolds = (c: Condition, e: NormalizedEvent, now: number): boolean => {
  switch (c.op) {
    case 'equals':
      return same(readPath(e.data, c.field), c.value)
    case 'in': {
      const v = readPath(e.data, c.field)
      return c.values.some((x) => same(v, x))
    }
    case 'matches': {
      const v = readPath(e.data, c.field)
      return typeof v === 'string' && safeRegexTest(c.pattern, v)
    }
    case 'member_has_role': {
      const roles = e.data.roles
      return Array.isArray(roles) && roles.includes(c.role_id)
    }
    case 'account_age_lt_days': {
      const created = e.data.account_created_at
      if (typeof created !== 'string') return false
      const ts = Date.parse(created)
      return Number.isFinite(ts) && now - ts < c.days * DAY_MS
    }
    case 'message_contains': {
      const content = e.data.content
      return typeof content === 'string' && content.toLowerCase().includes(c.text.toLowerCase())
    }
  }
}

export const eventMatches = (rule: Pick<Rule, 'trigger' | 'conditions'>, e: NormalizedEvent, now: number): boolean => {
  if (rule.trigger.event !== e.type) return false
  for (const [k, v] of Object.entries(rule.trigger.filter)) {
    if (!same(e.data[k], v)) return false
  }
  return rule.conditions.every((c) => conditionHolds(c, e, now))
}
