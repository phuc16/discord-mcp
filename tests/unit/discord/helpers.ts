import type { Rest, RestOpts } from '../../../src/discord/rest.js'

export interface Call {
  verb: string
  route: string
  query?: Record<string, string | number | undefined>
  body?: unknown
  reason?: string
  auth?: boolean
  files?: RestOpts['files']
}

type Responder = unknown | ((call: Call) => unknown)

export const recordingRest = (calls: Call[], responses: Record<string, Responder> = {}): Rest => {
  const make =
    (verb: string) =>
    async <T>(route: string, o: RestOpts = {}): Promise<T> => {
      const call: Call = { verb, route }
      if (o.query) call.query = o.query
      if (o.body !== undefined) call.body = o.body
      if (o.reason !== undefined) call.reason = o.reason
      if (o.auth !== undefined) call.auth = o.auth
      if (o.files) call.files = o.files
      calls.push(call)
      const r = responses[`${verb} ${route}`] ?? responses[route]
      return (typeof r === 'function' ? (r as (c: Call) => unknown)(call) : r) as T
    }
  return { get: make('get'), post: make('post'), patch: make('patch'), put: make('put'), delete: make('delete') }
}
