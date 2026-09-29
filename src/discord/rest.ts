import type { RawFile, REST } from 'discord.js'
import { createDiscordRest } from './client.js'
import { mapDiscordError } from './errors.js'

export interface RestOpts {
  body?: unknown
  query?: Record<string, string | number | undefined>
  reason?: string
  auth?: boolean
  files?: { name: string; data: Buffer; contentType?: string; key?: string }[]
}

export interface Rest {
  get<T>(route: string, o?: RestOpts): Promise<T>
  post<T>(route: string, o?: RestOpts): Promise<T>
  patch<T>(route: string, o?: RestOpts): Promise<T>
  put<T>(route: string, o?: RestOpts): Promise<T>
  delete<T>(route: string, o?: RestOpts): Promise<T>
}

type Verb = 'get' | 'post' | 'patch' | 'put' | 'delete'

const toRequest = (o: RestOpts = {}) => {
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(o.query ?? {})) if (v !== undefined) query.set(k, String(v))
  const files: RawFile[] | undefined = o.files?.map((f) => ({
    name: f.name,
    data: f.data,
    ...(f.key ? { key: f.key } : {}),
    ...(f.contentType ? { contentType: f.contentType } : {}),
  }))
  return {
    ...(o.body !== undefined ? { body: o.body } : {}),
    query,
    reason: o.reason,
    auth: o.auth ?? true,
    ...(files ? { files, appendToFormData: true } : {}),
  }
}

const call =
  (client: REST, verb: Verb) =>
  async <T>(route: string, o?: RestOpts): Promise<T> => {
    try {
      return (await client[verb](route as `/${string}`, toRequest(o))) as T
    } catch (err) {
      throw mapDiscordError(err)
    }
  }

export const createRest = (botToken: string, fetchImpl?: typeof fetch): Rest => {
  const client = createDiscordRest(botToken, fetchImpl)
  return {
    get: call(client, 'get'),
    post: call(client, 'post'),
    patch: call(client, 'patch'),
    put: call(client, 'put'),
    delete: call(client, 'delete'),
  }
}
