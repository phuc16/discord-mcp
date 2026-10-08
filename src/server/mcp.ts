import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SubscribeRequestSchema, UnsubscribeRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { randomUUID } from 'node:crypto'
import { McpToolError } from '../contracts/index.js'
import type { AnyToolDef, DiscordPort, Logger, NormalizedEvent, Principal, Services, ToolResult } from '../contracts/index.js'

export type ElicitResult = 'accept' | 'decline' | 'unsupported'

export type RunToolFn = (
  def: AnyToolDef,
  rawInput: unknown,
  principal: Principal,
  opts: { correlationId: string; elicit?: (message: string) => Promise<ElicitResult> },
) => Promise<ToolResult>

export interface EventFeed {
  subscribe(cb: (e: NormalizedEvent) => void): () => void
}

export interface ServerDeps {
  registry: Map<string, AnyToolDef>
  discord: DiscordPort
  services: Services
  logger: Logger
  runTool: RunToolFn
  recentEvents(guildId: string, limit: number): NormalizedEvent[]
  eventFeed?: EventFeed
}

const RESOURCE_EVENT_LIMIT = 100
const EVENTS_URI = /^discord:\/\/guild\/(\d+)\/events$/

const toContent = (payload: unknown): CallToolResult['content'] => [{ type: 'text', text: JSON.stringify(payload) }]

export const errorResult = (err: unknown, logger: Logger, correlationId: string): CallToolResult => {
  if (err instanceof McpToolError) {
    return { isError: true, content: toContent({ error: { code: err.code, message: err.message, details: err.details } }) }
  }
  logger.error({ correlation_id: correlationId, error: err instanceof Error ? err.name : 'unknown' }, 'unhandled tool error')
  return { isError: true, content: toContent({ error: { code: 'internal', message: 'internal error', details: {} } }) }
}

export const createMcpServer = (deps: ServerDeps, principalFor: () => Principal): McpServer => {
  const mcp = new McpServer({ name: 'discord-mcp', version: '0.1.0' })

  const elicit = async (message: string): Promise<ElicitResult> => {
    if (!mcp.server.getClientCapabilities()?.elicitation) return 'unsupported'
    try {
      const r = await mcp.server.elicitInput({ message, requestedSchema: { type: 'object', properties: {} } })
      return r.action === 'accept' ? 'accept' : 'decline'
    } catch {
      return 'unsupported'
    }
  }

  for (const def of deps.registry.values()) {
    mcp.registerTool(
      def.name,
      {
        description: def.description,
        inputSchema: def.input.shape,
        annotations: { readOnlyHint: def.tier === 'read', destructiveHint: def.tier === 'destructive' },
      },
      async (args: unknown): Promise<CallToolResult> => {
        const correlationId = randomUUID()
        try {
          const result = await deps.runTool(def, args, principalFor(), { correlationId, elicit })
          return { content: toContent(result.data) }
        } catch (err) {
          return errorResult(err, deps.logger, correlationId)
        }
      },
    )
  }

  const mayRead = (guildId: string): boolean => guildId in deps.services.policy.effective(principalFor()).guilds

  const guildIdOf = (uri: string): string => {
    const match = EVENTS_URI.exec(uri)
    if (!match?.[1]) throw new McpToolError('invalid_input', 'unknown resource uri')
    return match[1]
  }

  mcp.registerResource(
    'guild_events',
    new ResourceTemplate('discord://guild/{guild_id}/events', {
      list: async () => ({
        resources: Object.keys(deps.services.policy.effective(principalFor()).guilds).map((id) => ({
          uri: `discord://guild/${id}/events`,
          name: `events ${id}`,
          mimeType: 'application/json',
        })),
      }),
    }),
    { description: 'Recent live events for a guild', mimeType: 'application/json' },
    async (uri) => {
      const guildId = guildIdOf(uri.href)
      if (!mayRead(guildId)) throw new McpToolError('guild_not_allowed', 'guild not allowed')
      const events = deps.recentEvents(guildId, RESOURCE_EVENT_LIMIT)
      return { contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(events) }] }
    },
  )

  const subscribed = new Set<string>()
  mcp.server.registerCapabilities({ resources: { subscribe: true, listChanged: true } })
  mcp.server.setRequestHandler(SubscribeRequestSchema, async (req) => {
    const guildId = guildIdOf(req.params.uri)
    if (!mayRead(guildId)) throw new McpToolError('guild_not_allowed', 'guild not allowed')
    subscribed.add(req.params.uri)
    return {}
  })
  mcp.server.setRequestHandler(UnsubscribeRequestSchema, async (req) => {
    subscribed.delete(req.params.uri)
    return {}
  })

  if (deps.eventFeed) {
    const unsubscribe = deps.eventFeed.subscribe((e) => {
      const uri = `discord://guild/${e.guildId}/events`
      if (!subscribed.has(uri) || !mayRead(e.guildId)) return
      mcp.server.sendResourceUpdated({ uri }).catch(() => undefined)
    })
    const previous = mcp.server.onclose
    mcp.server.onclose = () => {
      unsubscribe()
      previous?.()
    }
  }

  return mcp
}
