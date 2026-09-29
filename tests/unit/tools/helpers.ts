import type { DiscordPort, Guards, Principal, Services, ToolContext } from '../../../src/contracts/index.js'

export const G = '1'.repeat(18)
export const OTHER_G = '9'.repeat(18)
export const id = (c: string): string => c.repeat(18)

export interface RecordedCall {
  method: string
  args: unknown[]
}

export type TestCtx = ToolContext & { calls: RecordedCall[] }

export const principal: Principal = { kind: 'stdio', userId: null, userName: 'tester', guilds: {} }

export const allowAllGuards: Guards = {
  assertCanGrantPermissions: () => undefined,
  assertCanPlaceRole: async () => undefined,
  assertCanActOnRole: async () => undefined,
  assertCanActOnMember: async () => undefined,
}

const noServices = new Proxy({}, {
  get: (_t, prop) => {
    throw new Error(`unexpected services access: ${String(prop)}`)
  },
}) as Services

export const makeCtx = (
  overrides: Partial<Omit<ToolContext, 'discord'>> & { discord?: Partial<DiscordPort> } = {},
): TestCtx => {
  const calls: RecordedCall[] = []
  const provided = (overrides.discord ?? {}) as Record<string, unknown>
  const discord = new Proxy({}, {
    get: (_t, prop) => {
      const method = String(prop)
      const impl = provided[method]
      if (typeof impl !== 'function') {
        return () => {
          throw new Error(`unexpected call: ${method}`)
        }
      }
      return (...args: unknown[]) => {
        calls.push({ method, args })
        return (impl as (...a: unknown[]) => unknown)(...args)
      }
    },
  }) as DiscordPort
  const noop = (): void => undefined
  return {
    principal,
    correlationId: 'corr-1',
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    services: noServices,
    guards: allowAllGuards,
    ...overrides,
    discord,
    calls,
  }
}

import type { AnyToolDef } from '../../../src/contracts/index.js'

export const byName = (tools: AnyToolDef[], name: string): AnyToolDef => {
  const t = tools.find((x) => x.name === name)
  if (!t) throw new Error(`tool not found: ${name}`)
  return t
}

export const run = async (tool: AnyToolDef, ctx: ToolContext, raw: Record<string, unknown>): Promise<unknown> => {
  const input = tool.input.parse(raw)
  return (await tool.handler(ctx, input)).data
}

export const runPreview = async (tool: AnyToolDef, ctx: ToolContext, raw: Record<string, unknown>) => {
  const input = tool.input.parse(raw)
  if (!tool.preview) throw new Error(`no preview: ${tool.name}`)
  return tool.preview(ctx, input)
}
