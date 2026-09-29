import { Worker } from 'node:worker_threads'
import { canonicalJson } from '../contracts/index.js'
import type { Condition, NormalizedEvent, Rule } from '../contracts/index.js'

const MAX_PATTERN = 200
const MAX_INPUT = 2000
const REGEX_TIMEOUT_MS = 100
const DAY_MS = 86_400_000
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', ({ pattern, input }) => {
  let hit = false
  try {
    hit = new RegExp(pattern).test(input)
  } catch {
    hit = false
  }
  parentPort.postMessage(hit)
})
`

export const readPath = (root: unknown, path: string): unknown => {
  let cur: unknown = root
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

const same = (a: unknown, b: unknown): boolean => a !== undefined && canonicalJson(a) === canonicalJson(b)

let worker: Worker | null = null
let queue: Promise<unknown> = Promise.resolve()

const killWorker = (): void => {
  void worker?.terminate()
  worker = null
}

const runInWorker = (pattern: string, input: string): Promise<boolean> =>
  new Promise((resolve) => {
    const w = (worker ??= new Worker(WORKER_SOURCE, { eval: true }))
    w.unref()
    const timer = setTimeout(() => {
      cleanup()
      killWorker()
      resolve(false)
    }, REGEX_TIMEOUT_MS)
    const onMessage = (hit: boolean): void => {
      cleanup()
      resolve(hit)
    }
    const onFailure = (): void => {
      cleanup()
      killWorker()
      resolve(false)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      w.off('message', onMessage)
      w.off('error', onFailure)
      w.off('exit', onFailure)
    }
    w.on('message', onMessage)
    w.on('error', onFailure)
    w.on('exit', onFailure)
    w.postMessage({ pattern, input })
  })

const safeRegexTest = (pattern: string, input: string): Promise<boolean> => {
  if (pattern.length > MAX_PATTERN) return Promise.resolve(false)
  const run = queue.then(() => runInWorker(pattern, input.slice(0, MAX_INPUT)))
  queue = run
  return run
}

const conditionHolds = async (c: Condition, e: NormalizedEvent, now: number): Promise<boolean> => {
  switch (c.op) {
    case 'equals':
      return same(readPath(e.data, c.field), c.value)
    case 'in': {
      const v = readPath(e.data, c.field)
      return c.values.some((x) => same(v, x))
    }
    case 'matches': {
      const v = readPath(e.data, c.field)
      return typeof v === 'string' && (await safeRegexTest(c.pattern, v))
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

export const eventMatches = async (rule: Pick<Rule, 'trigger' | 'conditions'>, e: NormalizedEvent, now: number): Promise<boolean> => {
  if (rule.trigger.event !== e.type) return false
  for (const [k, v] of Object.entries(rule.trigger.filter)) {
    if (!same(e.data[k], v)) return false
  }
  for (const c of rule.conditions) {
    if (!(await conditionHolds(c, e, now))) return false
  }
  return true
}
