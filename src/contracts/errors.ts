export const ERROR_CODES = [
  'guild_not_allowed', 'tier_exceeded', 'missing_permissions', 'not_found', 'rate_limited',
  'invalid_input', 'confirm_required', 'confirm_invalid', 'unauthorized', 'internal',
] as const
export type ErrorCode = (typeof ERROR_CODES)[number]

export class McpToolError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message)
    this.name = 'McpToolError'
  }
}

export const canonicalJson = (value: unknown): string => JSON.stringify(sortKeys(value))

const sortKeys = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([k, val]) => [k, sortKeys(val)]),
    )
  }
  return v
}
