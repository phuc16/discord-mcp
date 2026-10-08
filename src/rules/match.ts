import { Worker } from 'node:worker_threads'
import { canonicalJson } from '../contracts/index.js'
import type { Condition, NormalizedEvent, Rule } from '../contracts/index.js'

const MAX_PATTERN = 200
const MAX_INPUT = 2000
const REGEX_TIMEOUT_MS = 100
const DAY_MS = 86_400_000
const STARTUP_ALLOWANCE_MS = 5000
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads')
parentPort.on('message', ({ pattern, input }) => {
  parentPort.postMessage({ t: 'begin' })
  let hit = false
  try {
    hit = new RegExp(pattern).test(input)
  } catch {
    hit = false
  }
  parentPort.postMessage({ t: 'result', hit })
})
parentPort.postMessage({ t: 'ready' })
`

export type RegexFailureHook = (reason: 'timeout' | 'worker_failure' | 'startup_timeout') => void

export const readPath = (root: unknown, path: string): unknown => {
  let cur: unknown = root
  for (const key of path.split('.')) {
    if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, key)) return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

const same = (a: unknown, b: unknown): boolean => a !== undefined && canonicalJson(a) === canonicalJson(b)

interface WorkerHandle {
  worker: Worker
  ready: Promise<boolean>
}

let handle: WorkerHandle | null = null
let queue: Promise<unknown> = Promise.resolve()

const killWorker = (): void => {
  void handle?.worker.terminate()
  handle = null
}

const startWorker = (): WorkerHandle => {
  const worker = new Worker(WORKER_SOURCE, { eval: true })
  worker.unref()
  const ready = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => resolve(false), STARTUP_ALLOWANCE_MS)
    const done = (ok: boolean): void => {
      clearTimeout(timer)
      worker.off('message', onMessage)
      resolve(ok)
    }
    const onMessage = (m: { t: string }): void => {
      if (m.t === 'ready') done(true)
    }
    worker.on('message', onMessage)
    worker.once('error', () => done(false))
    worker.once('exit', () => done(false))
  })
  return { worker, ready }
}

type Outcome = { hit: boolean } | { failure: Parameters<RegexFailureHook>[0] }

const runInWorker = async (pattern: string, input: string): Promise<Outcome> => {
  const h = (handle ??= startWorker())
  if (!(await h.ready)) {
    if (handle === h) killWorker()
    return { failure: 'startup_timeout' }
  }
  return new Promise<Outcome>((resolve) => {
    const w = h.worker
    let execTimer: NodeJS.Timeout | null = null
    const beginGuard = setTimeout(() => finish({ failure: 'worker_failure' }, true), STARTUP_ALLOWANCE_MS)
    const finish = (o: Outcome, kill: boolean): void => {
      if (execTimer) clearTimeout(execTimer)
      clearTimeout(beginGuard)
      w.off('message', onMessage)
      w.off('error', onFailure)
      w.off('exit', onFailure)
      if (kill && handle === h) killWorker()
      resolve(o)
    }
    const onMessage = (m: { t: string; hit?: boolean }): void => {
      if (m.t === 'begin') {
        clearTimeout(beginGuard)
        execTimer = setTimeout(() => finish({ failure: 'timeout' }, true), REGEX_TIMEOUT_MS)
      } else if (m.t === 'result') finish({ hit: m.hit === true }, false)
    }
    const onFailure = (): void => finish({ failure: 'worker_failure' }, true)
    w.on('message', onMessage)
    w.on('error', onFailure)
    w.on('exit', onFailure)
    w.postMessage({ pattern, input })
  })
}

const safeRegexTest = (pattern: string, input: string, onFailure?: RegexFailureHook): Promise<boolean> => {
  if (pattern.length > MAX_PATTERN) return Promise.resolve(false)
  const run = queue.then(async () => {
    const outcome = await runInWorker(pattern, input.slice(0, MAX_INPUT))
    if ('failure' in outcome) {
      onFailure?.(outcome.failure)
      return false
    }
    return outcome.hit
  })
  queue = run
  return run
}

const conditionHolds = async (c: Condition, e: NormalizedEvent, now: number, onFailure?: RegexFailureHook): Promise<boolean> => {
  switch (c.op) {
    case 'equals':
      return same(readPath(e.data, c.field), c.value)
    case 'in': {
      const v = readPath(e.data, c.field)
      return c.values.some((x) => same(v, x))
    }
    case 'matches': {
      const v = readPath(e.data, c.field)
      return typeof v === 'string' && (await safeRegexTest(c.pattern, v, onFailure))
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

export const eventMatches = async (rule: Pick<Rule, 'trigger' | 'conditions'>, e: NormalizedEvent, now: number, onFailure?: RegexFailureHook): Promise<boolean> => {
  if (rule.trigger.event !== e.type) return false
  for (const [k, v] of Object.entries(rule.trigger.filter)) {
    if (!same(e.data[k], v)) return false
  }
  for (const c of rule.conditions) {
    if (!(await conditionHolds(c, e, now, onFailure))) return false
  }
  return true
}
