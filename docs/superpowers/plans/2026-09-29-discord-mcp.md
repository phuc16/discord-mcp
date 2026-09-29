# discord-mcp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. For the agent-team run, see "Agent Team Execution" at the end.

**Goal:** Build `discord-mcp`, a TypeScript MCP server for managing Discord guilds (about 90 tools), with live event streaming, an automation rules engine, a tiered safety policy with dry-run confirmation, and Discord-backed OAuth2 admin login over HTTP.

**Architecture:** Single-package modular monolith. `src/contracts/` holds all shared types; other modules code only against those and communicate through ports (`DiscordPort`, `EventsPort`, `RulesPort`, `AuditPort`, `PolicyView`). Every tool call, including rule actions, runs through one `runTool` safety pipeline. `DiscordPort` speaks raw Discord REST JSON (snake_case) so tools stay thin and the fake port stays simple.

**Tech Stack:** Node 22, TypeScript strict ESM (NodeNext, imports use `.js` suffix), `@modelcontextprotocol/sdk`, `discord.js` v14, `better-sqlite3`, `zod`, `pino`, `yaml`, `express`, pnpm, vitest, eslint (typescript-eslint), tsup.

Spec: `docs/superpowers/specs/2026-09-29-discord-mcp-design.md`. Section references below (for example "spec §8") point at it.

## Global Constraints

- Node >= 22; TypeScript `strict`; ESM only; relative imports end in `.js`.
- Gate for every task: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` all pass. Tests are written first.
- Coverage gate: 85% lines (`pnpm test:cov`).
- `discord.js` may be imported only inside `src/discord/`.
- Import boundaries (eslint-enforced): `contracts` imports nothing internal; `tools` -> `contracts` only; `rules` -> `contracts`, `safety`; `events`, `safety`, `auth` -> `contracts`, `store`; `discord`, `store` -> `contracts`; `server`, `cli` -> everything.
- Tool names are `snake_case`, unique, prefixed by group; tiers are `read | write | destructive`.
- Destructive tools must implement `preview`. Caps: `messages_purge` 1000 messages per call; `roles_bulk_assign`, `mod_bulk_ban` 200 targets per call.
- Confirm token: single use, TTL 5 minutes, bound to `sha256(canonical(input))` and principal.
- Access token TTL 1 hour, refresh token TTL 30 days, both opaque and stored hashed. PKCE S256 required. Redirect URI exact match. OAuth `state` single use, TTL 10 minutes.
- Structured logs (pino JSON) use fields `correlation_id`, `request_id`, `trace_id`, `span_id`, `method`, `path`, `status`, `ip`, `latency`, `user_name`, `ja4`. Never log the bot token, client secret, or any token.
- Error codes: `guild_not_allowed`, `tier_exceeded`, `missing_permissions`, `not_found`, `rate_limited`, `invalid_input`, `confirm_required`, `confirm_invalid`, `unauthorized`, `internal`.
- Guild binding: every tool input has `guild_id`, except tools flagged `unscoped` (read tier only). Tools acting via channel, webhook or invite ids must verify the resource belongs to `guild_id` before acting.
- Code style: no inline comments on self-documenting code; no zero-arg factory functions (use `const x: T = value`).
- Commit messages follow Conventional Commits and end with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.

## How to read the tasks

Tasks are grouped by owner (`core`, `discord`, `tools`, `safety`, `qa`). "Files" lists exactly what the task may touch; nothing outside the owner's tree is edited. "Interfaces" is the contract with neighbouring tasks: use exactly those names and signatures. Where a task covers many similar items (tools, port methods), the tables in the task are the exact deliverable and one fully written reference implementation shows the pattern to copy.

## Dependency graph

```
C1 scaffold ──► C2 contracts ──┬─► C3 store ──┬─► S2, D4, S5
                               ├─► D1 ──► D2, D3
                               ├─► T1 ──► T2..T6
                               ├─► S1 ──► S3
                               └─► Q1
C2 + C3 ──► C4 config/cli ──► C5 server ──► C6 docs
S3 ──► S4 (rules), S6 ; S5 ──► S6
Q2 needs T1..T6 registry ; Q3 needs S3 + Q1 + C5 ; Q4 needs S6 + Q1 + C5 ; Q5 needs D4 + S4 + Q1
```

Blocking chain: **C1 -> C2 first.** Nobody else starts until C2 is merged.

## File structure

```
package.json  tsconfig.json  tsup.config.ts  vitest.config.ts  eslint.config.js  .gitignore  .github/workflows/ci.yml  README.md  config.example.yaml
src/contracts/  tiers.ts errors.ts principal.ts tool.ts services.ts events.ts rules.ts audit.ts config.ts discord-port.ts index.ts
src/store/      db.ts migrations.ts audit-repo.ts confirm-repo.ts event-repo.ts rule-repo.ts oauth-repo.ts index.ts
src/cli/        main.ts invite-url.ts check.ts config-loader.ts logger.ts
src/server/     registry.ts mcp.ts http.ts app.ts index.ts
src/discord/    client.ts errors.ts rest-port.ts (+ per-group files) oauth.ts index.ts
src/events/     normalize.ts service.ts gateway.ts index.ts
src/safety/     permissions.ts policy.ts confirm.ts audit.ts limiter.ts pipeline.ts index.ts
src/rules/      match.ts template.ts engine.ts service.ts index.ts
src/auth/       provider.ts clients-store.ts tokens.ts bearer.ts principal.ts router.ts index.ts
src/tools/      define.ts index.ts guild.ts channels.ts threads.ts roles.ts members.ts moderation.ts messages.ts webhooks.ts scheduled-events.ts invites.ts emojis.ts audit-log.ts meta.ts
tests/unit/<module>/  tests/integration/  tests/e2e/  tests/contract/  tests/fakes/
docs/getting-started.md  docs/smoke-checklist.md
```

---

# Part A: `core`

Owner tree: `package.json`, configs, `.github/`, `README.md`, `config.example.yaml`, `src/contracts/`, `src/store/`, `src/cli/`, `src/server/`, `docs/getting-started.md`, `docs/smoke-checklist.md`, `tests/unit/{contracts,store,cli,server}/`.

## Task C1: Scaffold, tooling, boundary lint (blocks everything)

**Depends on:** none

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsup.config.ts`, `vitest.config.ts`, `eslint.config.js`, `.gitignore`, `.github/workflows/ci.yml`, `src/contracts/index.ts` (empty export placeholder replaced in C2), `tests/unit/lint-boundaries.test.ts`

**Interfaces:**
- Produces: scripts `pnpm typecheck | lint | test | test:cov | build | check`; eslint boundary rules exactly as in Global Constraints.

**Acceptance:** `pnpm check` passes on the scaffold; a test proves the boundary rules reject a forbidden import and a `discord.js` import outside `src/discord/`.

- [ ] **Step 1: Install dependencies**

```bash
cd /Users/phucth/vibes/discord-mcp
pnpm init
pnpm add @modelcontextprotocol/sdk discord.js better-sqlite3 zod pino yaml express
pnpm add -D typescript tsup vitest @vitest/coverage-v8 eslint typescript-eslint @types/node @types/express @types/better-sqlite3
```

- [ ] **Step 2: Write `package.json` fields** (merge into generated file)

```json
{
  "name": "discord-mcp",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "bin": { "discord-mcp": "dist/cli/main.js" },
  "scripts": {
    "build": "tsup",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:cov": "vitest run --coverage",
    "check": "pnpm typecheck && pnpm lint && pnpm test && pnpm build"
  }
}
```

- [ ] **Step 3: Write configs**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "types": ["node"]
  },
  "include": ["src", "tests", "*.ts"]
}
```

`tsup.config.ts`:
```ts
import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/cli/main.ts'],
  format: ['esm'],
  target: 'node22',
  sourcemap: true,
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/main.ts', 'src/contracts/**'],
      thresholds: { lines: 85 },
    },
  },
})
```

`.gitignore`: `node_modules`, `dist`, `coverage`, `*.db`, `*.db-wal`, `*.db-shm`, `config.yaml`, `.env`.

`.github/workflows/ci.yml`:
```yaml
name: ci
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm typecheck
      - run: pnpm lint
      - run: pnpm test:cov
      - run: pnpm build
```

- [ ] **Step 4: Write the failing boundary test** `tests/unit/lint-boundaries.test.ts`

```ts
import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

const eslint = new ESLint()

async function messages(filePath: string, code: string) {
  const [result] = await eslint.lintText(code, { filePath })
  return result?.messages.map((m) => m.ruleId) ?? []
}

describe('import boundaries', () => {
  it('rejects tools importing discord', async () => {
    const ids = await messages('src/tools/x.ts', "import { a } from '../discord/index.js'\nexport const b = a\n")
    expect(ids).toContain('no-restricted-imports')
  })
  it('rejects tools importing store', async () => {
    const ids = await messages('src/tools/x.ts', "import { a } from '../store/index.js'\nexport const b = a\n")
    expect(ids).toContain('no-restricted-imports')
  })
  it('rejects discord.js outside src/discord', async () => {
    const ids = await messages('src/safety/x.ts', "import { Client } from 'discord.js'\nexport const c = Client\n")
    expect(ids).toContain('no-restricted-imports')
  })
  it('allows discord.js inside src/discord', async () => {
    const ids = await messages('src/discord/x.ts', "import { Client } from 'discord.js'\nexport const c = Client\n")
    expect(ids).not.toContain('no-restricted-imports')
  })
  it('allows tools importing contracts', async () => {
    const ids = await messages('src/tools/x.ts', "import { a } from '../contracts/index.js'\nexport const b = a\n")
    expect(ids).not.toContain('no-restricted-imports')
  })
})
```

- [ ] **Step 5: Run it, expect FAIL** (`eslint.config.js` missing)

Run: `pnpm vitest run tests/unit/lint-boundaries.test.ts` — Expected: FAIL.

- [ ] **Step 6: Write `eslint.config.js`**

```js
import tseslint from 'typescript-eslint'

const modules = ['contracts', 'discord', 'events', 'safety', 'rules', 'auth', 'store', 'tools', 'server', 'cli']
const allowed = {
  contracts: [],
  tools: ['contracts'],
  rules: ['contracts', 'safety'],
  events: ['contracts', 'store'],
  safety: ['contracts', 'store'],
  auth: ['contracts', 'store'],
  discord: ['contracts'],
  store: ['contracts'],
}

const discordJs = { name: 'discord.js', message: 'discord.js may only be imported inside src/discord/' }

const boundaryConfigs = Object.entries(allowed).map(([mod, ok]) => ({
  files: [`src/${mod}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: mod === 'discord' ? [] : [discordJs],
        patterns: modules
          .filter((m) => m !== mod && !ok.includes(m))
          .flatMap((m) => [
            { group: [`**/${m}`, `**/${m}/**`], message: `src/${mod} must not import src/${m}` },
          ]),
      },
    ],
  },
}))

const looseConfigs = ['server', 'cli'].map((mod) => ({
  files: [`src/${mod}/**/*.ts`],
  rules: { 'no-restricted-imports': ['error', { paths: [discordJs] }] },
}))

export default tseslint.config(
  { ignores: ['dist', 'coverage', 'node_modules'] },
  ...tseslint.configs.recommended,
  ...boundaryConfigs,
  ...looseConfigs,
)
```

`server` and `cli` also may not import `discord.js`; they get the `DiscordPort` implementation via `src/discord/index.ts` only.

- [ ] **Step 7: Run tests, expect PASS; run `pnpm typecheck && pnpm lint`**

Note: `**/discord` would also match the `discord.js` package specifier `discord.js`? It does not (`**/discord` requires a path segment named exactly `discord`), so the package rule is separate. If a boundary test fails on this, adjust the group globs, not the tests.

- [ ] **Step 8: Add `src/contracts/index.ts` as `export {}` and a smoke test** `tests/unit/smoke.test.ts` (`expect(1).toBe(1)`), run `pnpm check`, then commit.

```bash
git add -A && git commit -m "chore: scaffold project tooling and import-boundary lint

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Task C2: Contracts (blocks everything)

**Depends on:** C1

**Files:**
- Create: `src/contracts/{tiers,errors,principal,tool,services,events,rules,audit,config,discord-port,index}.ts`
- Test: `tests/unit/contracts/contracts.test.ts`

**Acceptance:** all exports below exist with these exact names; zod schemas parse valid and reject invalid samples; `pnpm check` passes. After merge, message all teammates: "contracts merged".

- [ ] **Step 1: Write failing tests** (`tests/unit/contracts/contracts.test.ts`)

```ts
import { describe, expect, it } from 'vitest'
import { ConfigSchema, McpToolError, canonicalJson, isTier, maxTier, minTier, tierRank } from '../../../src/contracts/index.js'

describe('tiers', () => {
  it('ranks read < write < destructive', () => {
    expect(tierRank.read).toBeLessThan(tierRank.write)
    expect(tierRank.write).toBeLessThan(tierRank.destructive)
  })
  it('min and max', () => {
    expect(minTier('read', 'destructive')).toBe('read')
    expect(maxTier('write', 'read')).toBe('write')
  })
  it('isTier guards', () => {
    expect(isTier('write')).toBe(true)
    expect(isTier('root')).toBe(false)
  })
})

describe('McpToolError', () => {
  it('carries code and details', () => {
    const e = new McpToolError('rate_limited', 'slow down', { retry_after: 3 })
    expect(e.code).toBe('rate_limited')
    expect(e.details).toEqual({ retry_after: 3 })
  })
})

describe('canonicalJson', () => {
  it('sorts keys deeply and is stable', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { z: 1, y: 2 }] } })).toBe('{"a":{"c":[3,{"y":2,"z":1}],"d":2},"b":1}')
  })
})

describe('ConfigSchema', () => {
  const valid = {
    guilds: { '123456789012345678': { max_tier: 'destructive' } },
    tools: { deny: ['guild_prune'] },
    rate_limits: { bulk_per_minute: 5 },
    events: { retention_hours: 72, max_buffer: 50000 },
    http: { host: '0.0.0.0', port: 8787, service_tokens: [{ name: 'ci', sha256: 'a'.repeat(64) }] },
  }
  it('accepts valid config and fills defaults', () => {
    const parsed = ConfigSchema.parse({ guilds: valid.guilds })
    expect(parsed.rate_limits.bulk_per_minute).toBe(5)
    expect(parsed.events.retention_hours).toBe(72)
    expect(parsed.http.port).toBe(8787)
    expect(parsed.tools.deny).toEqual([])
  })
  it('rejects bad tier and non-snowflake guild id', () => {
    expect(() => ConfigSchema.parse({ guilds: { '123456789012345678': { max_tier: 'root' } } })).toThrow()
    expect(() => ConfigSchema.parse({ guilds: { abc: { max_tier: 'read' } } })).toThrow()
  })
  it('rejects empty guild map', () => {
    expect(() => ConfigSchema.parse({ guilds: {} })).toThrow()
  })
})
```

- [ ] **Step 2: Run tests, expect FAIL** (`pnpm vitest run tests/unit/contracts`)

- [ ] **Step 3: Implement**

`src/contracts/tiers.ts`:
```ts
export const TIERS = ['read', 'write', 'destructive'] as const
export type Tier = (typeof TIERS)[number]
export const tierRank: Record<Tier, number> = { read: 0, write: 1, destructive: 2 }
export const isTier = (v: unknown): v is Tier => typeof v === 'string' && (TIERS as readonly string[]).includes(v)
export const minTier = (a: Tier, b: Tier): Tier => (tierRank[a] <= tierRank[b] ? a : b)
export const maxTier = (a: Tier, b: Tier): Tier => (tierRank[a] >= tierRank[b] ? a : b)
```

`src/contracts/errors.ts`:
```ts
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
```

`src/contracts/principal.ts`:
```ts
export interface Principal {
  kind: 'stdio' | 'service' | 'user'
  userId: string | null
  userName: string
  guilds: Record<string, string>
}
export const principalKey = (p: Principal): string => `${p.kind}:${p.userId ?? p.userName}`
```
`guilds` maps guild id to Discord permission bits as a decimal string (JSON-safe); consumers use `BigInt(value)`. Empty for `stdio`/`service`.

`src/contracts/events.ts`:
```ts
export const EVENT_TYPES = [
  'message_create', 'message_update', 'message_delete', 'member_join', 'member_remove', 'member_ban',
  'member_unban', 'role_create', 'role_update', 'role_delete', 'channel_create', 'channel_update',
  'channel_delete', 'voice_state', 'scheduled_event', 'gap',
] as const
export type EventType = (typeof EVENT_TYPES)[number]

export interface NormalizedEvent {
  id: number
  guildId: string
  type: EventType
  at: string
  data: Record<string, unknown>
}
export type NewEvent = Omit<NormalizedEvent, 'id'>
```

`src/contracts/audit.ts`:
```ts
import type { Tier } from './tiers.js'

export interface AuditEntry {
  id: number
  at: string
  correlationId: string
  tool: string
  tier: Tier
  guildId: string | null
  actor: string
  actorUserId: string | null
  inputHash: string
  outcome: 'ok' | 'dry_run' | 'denied' | 'error'
  errorCode: string | null
  latencyMs: number
}
export type NewAuditEntry = Omit<AuditEntry, 'id'>
export interface AuditQuery { guildId?: string; tool?: string; actorUserId?: string; limit: number; beforeId?: number }
```

`src/contracts/rules.ts`:
```ts
import { z } from 'zod'
import { EVENT_TYPES } from './events.js'

export const ConditionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('equals'), field: z.string(), value: z.unknown() }),
  z.object({ op: z.literal('matches'), field: z.string(), pattern: z.string().max(200) }),
  z.object({ op: z.literal('in'), field: z.string(), values: z.array(z.unknown()).max(100) }),
  z.object({ op: z.literal('member_has_role'), role_id: z.string() }),
  z.object({ op: z.literal('account_age_lt_days'), days: z.number().positive() }),
  z.object({ op: z.literal('message_contains'), text: z.string().min(1).max(200) }),
])
export type Condition = z.infer<typeof ConditionSchema>

export const ActionSpecSchema = z.object({
  tool: z.string(),
  input_template: z.record(z.string(), z.unknown()),
})
export type ActionSpec = z.infer<typeof ActionSpecSchema>

export const RuleInputSchema = z.object({
  guild_id: z.string(),
  trigger: z.object({ event: z.enum(EVENT_TYPES), filter: z.record(z.string(), z.unknown()).default({}) }),
  conditions: z.array(ConditionSchema).max(20).default([]),
  actions: z.array(ActionSpecSchema).min(1).max(10),
  cooldown_sec: z.number().int().min(0).max(86400).default(0),
  allow_destructive: z.boolean().default(false),
  enabled: z.boolean().default(true),
})
export type RuleInput = z.infer<typeof RuleInputSchema>

export interface Rule extends RuleInput {
  id: string
  owner_user_id: string | null
  created_at: string
  disabled_reason: string | null
}

export interface RuleTestResult { matched: boolean; actions: { tool: string; input: Record<string, unknown>; outcome: string }[] }
```

`src/contracts/tool.ts`:
```ts
import type { z } from 'zod'
import type { DiscordPort } from './discord-port.js'
import type { Principal } from './principal.js'
import type { Services } from './services.js'
import type { Tier } from './tiers.js'

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void
  warn(obj: Record<string, unknown>, msg?: string): void
  error(obj: Record<string, unknown>, msg?: string): void
  debug(obj: Record<string, unknown>, msg?: string): void
}

export interface ToolContext {
  discord: DiscordPort
  principal: Principal
  correlationId: string
  logger: Logger
  services: Services
}

export interface PreviewResult { summary: string; affected: Record<string, number>; details?: unknown }
export interface ToolResult { data: unknown }

export interface ToolDef<S extends z.ZodObject<z.ZodRawShape> = z.ZodObject<z.ZodRawShape>> {
  name: string
  group: string
  description: string
  tier: Tier
  input: S
  guildFrom: (input: z.infer<S>) => string | null
  preview?: (ctx: ToolContext, input: z.infer<S>) => Promise<PreviewResult>
  handler: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolResult>
}

export type AnyToolDef = ToolDef<z.ZodObject<z.ZodRawShape>>
```

`src/contracts/services.ts`:
```ts
import type { AuditEntry, AuditQuery } from './audit.js'
import type { EventType, NormalizedEvent } from './events.js'
import type { Principal } from './principal.js'
import type { Rule, RuleInput, RuleTestResult } from './rules.js'
import type { Tier } from './tiers.js'

export interface EventsPort {
  poll(principal: Principal, q: { guildId: string; sinceId: number; types?: EventType[]; limit: number }): Promise<NormalizedEvent[]>
}

export interface RulesPort {
  create(principal: Principal, input: RuleInput): Promise<Rule>
  list(principal: Principal, guildId: string): Promise<Rule[]>
  update(principal: Principal, id: string, patch: Partial<RuleInput>): Promise<Rule>
  remove(principal: Principal, id: string): Promise<void>
  test(principal: Principal, id: string, sample: NormalizedEvent): Promise<RuleTestResult>
}

export interface AuditPort {
  query(principal: Principal, q: AuditQuery): Promise<AuditEntry[]>
}

export interface EffectivePolicy {
  guilds: Record<string, { maxTier: Tier; effectiveTier: Tier }>
  deniedTools: string[]
}
export interface PolicyView { effective(principal: Principal): EffectivePolicy }

export interface Services { events: EventsPort; rules: RulesPort; audit: AuditPort; policy: PolicyView }
```

`src/contracts/config.ts`:
```ts
import { z } from 'zod'
import { TIERS } from './tiers.js'

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake')

export const ConfigSchema = z.object({
  guilds: z.record(snowflake, z.object({ max_tier: z.enum(TIERS) })).refine((g) => Object.keys(g).length > 0, 'at least one guild required'),
  tools: z.object({ deny: z.array(z.string()).default([]) }).default({ deny: [] }),
  rate_limits: z.object({ bulk_per_minute: z.number().int().positive().default(5) }).default({ bulk_per_minute: 5 }),
  events: z
    .object({ retention_hours: z.number().positive().default(72), max_buffer: z.number().int().positive().default(50000) })
    .default({ retention_hours: 72, max_buffer: 50000 }),
  http: z
    .object({
      host: z.string().default('0.0.0.0'),
      port: z.number().int().min(1).max(65535).default(8787),
      service_tokens: z.array(z.object({ name: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) })).default([]),
    })
    .default({ host: '0.0.0.0', port: 8787, service_tokens: [] }),
  message_content_intent: z.boolean().default(false),
  database_path: z.string().default('./discord-mcp.db'),
})
export type Config = z.infer<typeof ConfigSchema>
```

`src/contracts/discord-port.ts` (raw Discord REST shapes; `Dto` is a Discord JSON object; the file starts with `import type { NewEvent } from './events.js'`):
```ts
export type Snowflake = string
export type Dto = { id: Snowflake } & Record<string, unknown>
export type Payload = Record<string, unknown>

export interface DiscordPort {
  listBotGuildIds(): Promise<Snowflake[]>
  fetchMemberPermissions(guildId: Snowflake, userId: Snowflake): Promise<string>

  getGuild(guildId: Snowflake): Promise<Dto>
  listGuilds(): Promise<Dto[]>
  updateGuild(guildId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  getGuildPreview(guildId: Snowflake): Promise<Dto>
  getPruneCount(guildId: Snowflake, days: number): Promise<{ pruned: number }>
  pruneGuild(guildId: Snowflake, days: number, reason?: string): Promise<{ pruned: number }>
  getWidget(guildId: Snowflake): Promise<Payload>
  updateWidget(guildId: Snowflake, patch: Payload): Promise<Payload>

  listChannels(guildId: Snowflake): Promise<Dto[]>
  getChannel(channelId: Snowflake): Promise<Dto>
  createChannel(guildId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateChannel(channelId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  moveChannels(guildId: Snowflake, positions: { id: Snowflake; position: number; parent_id?: Snowflake | null }[]): Promise<void>
  setChannelPermissions(channelId: Snowflake, overwriteId: Snowflake, body: { type: 0 | 1; allow: string; deny: string }, reason?: string): Promise<void>
  deleteChannelPermissions(channelId: Snowflake, overwriteId: Snowflake, reason?: string): Promise<void>
  deleteChannel(channelId: Snowflake, reason?: string): Promise<Dto>

  listActiveThreads(guildId: Snowflake): Promise<Dto[]>
  listArchivedThreads(channelId: Snowflake, q: { kind: 'public' | 'private'; before?: string; limit?: number }): Promise<Dto[]>
  createThread(channelId: Snowflake, spec: Payload & { message_id?: Snowflake }, reason?: string): Promise<Dto>
  addThreadMember(threadId: Snowflake, userId: Snowflake): Promise<void>
  removeThreadMember(threadId: Snowflake, userId: Snowflake): Promise<void>
  createForumPost(channelId: Snowflake, spec: Payload, reason?: string): Promise<Dto>

  listRoles(guildId: Snowflake): Promise<Dto[]>
  createRole(guildId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateRole(guildId: Snowflake, roleId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  reorderRoles(guildId: Snowflake, positions: { id: Snowflake; position: number }[]): Promise<Dto[]>
  deleteRole(guildId: Snowflake, roleId: Snowflake, reason?: string): Promise<void>

  listMembers(guildId: Snowflake, q: { limit: number; after?: Snowflake }): Promise<Dto[]>
  getMember(guildId: Snowflake, userId: Snowflake): Promise<Dto>
  searchMembers(guildId: Snowflake, query: string, limit: number): Promise<Dto[]>
  updateMember(guildId: Snowflake, userId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  addMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake, reason?: string): Promise<void>
  removeMemberRole(guildId: Snowflake, userId: Snowflake, roleId: Snowflake, reason?: string): Promise<void>

  kickMember(guildId: Snowflake, userId: Snowflake, reason?: string): Promise<void>
  banMember(guildId: Snowflake, userId: Snowflake, o: { delete_message_seconds?: number }, reason?: string): Promise<void>
  unbanMember(guildId: Snowflake, userId: Snowflake, reason?: string): Promise<void>
  bulkBan(guildId: Snowflake, userIds: Snowflake[], o: { delete_message_seconds?: number }, reason?: string): Promise<{ banned_users: Snowflake[]; failed_users: Snowflake[] }>
  listBans(guildId: Snowflake, q: { limit: number; after?: Snowflake }): Promise<Payload[]>
  listAutomodRules(guildId: Snowflake): Promise<Dto[]>
  createAutomodRule(guildId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateAutomodRule(guildId: Snowflake, ruleId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  deleteAutomodRule(guildId: Snowflake, ruleId: Snowflake, reason?: string): Promise<void>

  listMessages(channelId: Snowflake, q: { limit: number; before?: Snowflake; after?: Snowflake }): Promise<Dto[]>
  getMessage(channelId: Snowflake, messageId: Snowflake): Promise<Dto>
  sendMessage(channelId: Snowflake, body: Payload): Promise<Dto>
  editMessage(channelId: Snowflake, messageId: Snowflake, body: Payload): Promise<Dto>
  deleteMessage(channelId: Snowflake, messageId: Snowflake, reason?: string): Promise<void>
  bulkDeleteMessages(channelId: Snowflake, messageIds: Snowflake[], reason?: string): Promise<void>
  pinMessage(channelId: Snowflake, messageId: Snowflake, reason?: string): Promise<void>
  unpinMessage(channelId: Snowflake, messageId: Snowflake, reason?: string): Promise<void>
  listPins(channelId: Snowflake): Promise<Dto[]>
  crosspostMessage(channelId: Snowflake, messageId: Snowflake): Promise<Dto>
  addReaction(channelId: Snowflake, messageId: Snowflake, emoji: string): Promise<void>
  removeReaction(channelId: Snowflake, messageId: Snowflake, emoji: string, userId?: Snowflake): Promise<void>
  clearReactions(channelId: Snowflake, messageId: Snowflake): Promise<void>

  listWebhooks(scope: { guildId: Snowflake } | { channelId: Snowflake }): Promise<Dto[]>
  createWebhook(channelId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateWebhook(webhookId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  executeWebhook(webhookId: Snowflake, token: string, body: Payload): Promise<Dto | null>
  deleteWebhook(webhookId: Snowflake, reason?: string): Promise<void>

  listScheduledEvents(guildId: Snowflake): Promise<Dto[]>
  getScheduledEvent(guildId: Snowflake, eventId: Snowflake): Promise<Dto>
  createScheduledEvent(guildId: Snowflake, spec: Payload, reason?: string): Promise<Dto>
  updateScheduledEvent(guildId: Snowflake, eventId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  listScheduledEventUsers(guildId: Snowflake, eventId: Snowflake, limit: number): Promise<Payload[]>
  deleteScheduledEvent(guildId: Snowflake, eventId: Snowflake): Promise<void>

  listInvites(guildId: Snowflake): Promise<Payload[]>
  createInvite(channelId: Snowflake, spec: Payload, reason?: string): Promise<Payload>
  deleteInvite(code: string, reason?: string): Promise<Payload>

  listEmojis(guildId: Snowflake): Promise<Dto[]>
  createEmoji(guildId: Snowflake, spec: { name: string; image: string; roles?: Snowflake[] }, reason?: string): Promise<Dto>
  updateEmoji(guildId: Snowflake, emojiId: Snowflake, patch: Payload, reason?: string): Promise<Dto>
  deleteEmoji(guildId: Snowflake, emojiId: Snowflake, reason?: string): Promise<void>
  listStickers(guildId: Snowflake): Promise<Dto[]>
  createSticker(guildId: Snowflake, spec: { name: string; description: string; tags: string; file: string }, reason?: string): Promise<Dto>
  deleteSticker(guildId: Snowflake, stickerId: Snowflake, reason?: string): Promise<void>

  listAuditLog(guildId: Snowflake, q: { user_id?: Snowflake; action_type?: number; limit?: number; before?: Snowflake }): Promise<Payload>
}

export type GatewayStatus = 'connecting' | 'ready' | 'disconnected'
export interface GatewayPort {
  start(): Promise<void>
  stop(): Promise<void>
  onEvent(cb: (e: NewEvent) => void): () => void
  onStatus(cb: (s: GatewayStatus) => void): () => void
  status(): GatewayStatus
}

export interface DiscordOAuthPort {
  exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string }>
  fetchUser(accessToken: string): Promise<{ id: Snowflake; username: string }>
  fetchUserGuilds(accessToken: string): Promise<{ id: Snowflake; permissions: string }[]>
}
```
Method names are final. `image` and `file` for emoji and sticker are base64 data URIs / raw base64 as Discord expects.

`src/contracts/index.ts` re-exports everything (`export * from './tiers.js'` and so on for each file).

- [ ] **Step 4: Run tests, expect PASS; `pnpm typecheck && pnpm lint`**

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(contracts): add shared types, schemas, errors and ports

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

## Task C3: Store (SQLite)

**Depends on:** C2

**Files:**
- Create: `src/store/{db,migrations,audit-repo,confirm-repo,event-repo,rule-repo,oauth-repo,index}.ts`
- Test: `tests/unit/store/*.test.ts`

**Interfaces (Produces, exact):**
```ts
export interface Store {
  audit: AuditRepo; confirmations: ConfirmRepo; events: EventRepo; rules: RuleRepo; oauth: OAuthRepo
  close(): void
}
export const openStore = (path: string): Store   // ':memory:' allowed; runs migrations; WAL for files

interface AuditRepo { insert(e: NewAuditEntry): AuditEntry; query(q: AuditQuery): AuditEntry[] }   // newest first
interface ConfirmRepo {
  create(c: { tokenHash: string; inputHash: string; principalKey: string; tool: string; expiresAt: number }): void
  consume(c: { tokenHash: string; inputHash: string; principalKey: string; tool: string; now: number }): 'ok' | 'invalid' | 'expired'
}
interface EventRepo {
  append(e: NewEvent): NormalizedEvent
  since(q: { guildId: string; sinceId: number; types?: EventType[]; limit: number }): NormalizedEvent[]   // ascending id
  prune(o: { olderThanIso: string; maxRows: number }): number
  latestId(): number
}
interface RuleRepo {
  insert(r: Rule): void; get(id: string): Rule | null; list(guildId?: string): Rule[]
  update(id: string, patch: Partial<Rule>): Rule; delete(id: string): void
  listByEvent(guildId: string, type: EventType): Rule[]           // enabled only
  getCooldownUntil(id: string): number; setCooldownUntil(id: string, ms: number): void
}
interface OAuthClient { clientId: string; clientSecretHash: string | null; redirectUris: string[]; clientName: string; createdAt: string }
interface PendingAuth { state: string; clientId: string; redirectUri: string; codeChallenge: string; clientState: string | null; scopes: string[]; expiresAt: number }
interface AuthCode { codeHash: string; clientId: string; redirectUri: string; codeChallenge: string; userId: string; userName: string; guilds: Record<string, string>; expiresAt: number }
interface Session {
  familyId: string; accessHash: string; refreshHash: string; clientId: string; userId: string; userName: string
  guilds: Record<string, string>; accessExpiresAt: number; refreshExpiresAt: number; revoked: boolean
}
interface OAuthRepo {
  saveClient(c: OAuthClient): void; getClient(id: string): OAuthClient | null
  savePending(p: PendingAuth): void; consumePending(state: string, now: number): PendingAuth | null      // single use
  saveCode(c: AuthCode): void; consumeCode(codeHash: string, now: number): AuthCode | null               // single use
  saveSession(s: Session): void
  getByAccessHash(h: string): Session | null
  rotateRefresh(o: { oldRefreshHash: string; newRefreshHash: string; newAccessHash: string; accessExpiresAt: number; refreshExpiresAt: number; guilds: Record<string, string>; now: number }): { session: Session } | { reuse: true; familyId: string } | null
  revokeFamily(familyId: string): void
  revokeByTokenHash(h: string): void
  listSessionsForUser(userId: string): Session[]
}
```
`rotateRefresh` returns `{ reuse: true }` (and revokes the family) if `oldRefreshHash` was previously rotated (kept in `oauth_refresh_history`), `null` if unknown or expired.

**Acceptance:** each repo has tests including atomic single-use behavior (`consume*` second call returns invalid/null), pruning by age and by max rows, refresh reuse detection revoking the family, WAL enabled for file DBs, migrations idempotent and versioned via `meta.schema_version`. Tables: `audit`, `confirmations`, `events`, `rules`, `oauth_clients`, `oauth_codes`, `oauth_sessions`, `oauth_states`, `oauth_refresh_history`, `meta`.

- [ ] **Step 1:** Write failing tests for `openStore(':memory:')` migrations (`schema_version` equals number of migrations, reopening does not re-run) and `AuditRepo` insert/query ordering and filters.
- [ ] **Step 2:** Run, expect FAIL. Implement `db.ts` (`better-sqlite3`, `PRAGMA journal_mode=WAL` for files, `foreign_keys=ON`), `migrations.ts` (array of `{version, sql}` applied in a transaction), and `audit-repo.ts`. Run, expect PASS. Commit.
- [ ] **Step 3:** Failing tests then implementation for `ConfirmRepo`: consume returns `ok` once, then `invalid`; wrong `inputHash`/`principalKey`/`tool` returns `invalid` without consuming; expired returns `expired`. Use `DELETE ... RETURNING` or a single `UPDATE ... WHERE used=0` inside a transaction so consume is atomic. Commit.
- [ ] **Step 4:** Failing tests then implementation for `EventRepo`: monotonic ids (`INTEGER PRIMARY KEY AUTOINCREMENT`), `since` filters by guild, types and limit; `prune` drops rows older than cutoff and trims to `maxRows` keeping newest. Commit.
- [ ] **Step 5:** Failing tests then implementation for `RuleRepo` (JSON columns for trigger, conditions, actions; `listByEvent` returns enabled rules only; cooldown get/set). Commit.
- [ ] **Step 6:** Failing tests then implementation for `OAuthRepo`: client round trip, pending and code single-use with expiry, session save and `getByAccessHash` (revoked or expired-not-checked here; caller checks expiry), rotation success, rotation reuse detection revoking the family, revoke by token hash. Hash inputs are supplied by callers (repo never sees plaintext tokens). Commit.
- [ ] **Step 7:** `src/store/index.ts` exports `openStore` and all repo/row types. Run `pnpm check`. Commit `feat(store): sqlite store with migrations and repositories`.

## Task C4: Config loader, logger, CLI (`--check`, `invite-url`)

**Depends on:** C2, C3

**Files:**
- Create: `src/cli/{config-loader,logger,invite-url,check,main}.ts`, `config.example.yaml`
- Test: `tests/unit/cli/*.test.ts`

**Interfaces:**
- Produces:
```ts
export const loadConfig = (path: string, env?: NodeJS.ProcessEnv): Config              // throws with readable zod issues
export const createLogger = (opts: { level?: string; destination?: NodeJS.WritableStream }): Logger   // pino, redacts secrets
export const PERMISSION_PRESETS: Record<'read' | 'moderator' | 'manager' | 'admin', bigint>
export const buildInviteUrl = (clientId: string, preset: string | bigint): string
```
- Consumes: `ConfigSchema`, `Logger` from contracts.

**Acceptance:** invalid config gives a message listing each failing path; logger never emits tokens (redaction test); `invite-url` unknown preset exits non-zero; `--check` validates config file, required env vars (`DISCORD_BOT_TOKEN`, and for `--http`: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUBLIC_BASE_URL`, `TOKEN_SIGNING_KEY`), and reports each missing name.

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { PERMISSION_PRESETS, buildInviteUrl } from '../../../src/cli/invite-url.js'

describe('invite url', () => {
  it('builds a bot-scope url with permissions', () => {
    const url = new URL(buildInviteUrl('111', 'admin'))
    expect(url.origin + url.pathname).toBe('https://discord.com/oauth2/authorize')
    expect(url.searchParams.get('client_id')).toBe('111')
    expect(url.searchParams.get('scope')).toBe('bot')
    expect(url.searchParams.get('permissions')).toBe('8')
  })
  it('accepts numeric bits', () => {
    expect(new URL(buildInviteUrl('1', 8192n)).searchParams.get('permissions')).toBe('8192')
  })
  it('rejects unknown preset', () => {
    expect(() => buildInviteUrl('1', 'root')).toThrow(/unknown preset/i)
  })
  it('presets are cumulative', () => {
    const { read, moderator, manager, admin } = PERMISSION_PRESETS
    expect(moderator & read).toBe(read)
    expect(manager & moderator).toBe(moderator)
    expect(admin).toBe(8n)
  })
})
```

- [ ] **Step 2: Run, expect FAIL. Implement** `invite-url.ts`:

```ts
const bit = (n: bigint): bigint => 1n << n
const VIEW_CHANNEL = bit(10n), READ_HISTORY = bit(16n), VIEW_AUDIT_LOG = bit(7n)
const KICK = bit(1n), BAN = bit(2n), MOD_MEMBERS = bit(40n), MANAGE_MESSAGES = bit(13n), MANAGE_THREADS = bit(34n)
const MANAGE_CHANNELS = bit(4n), MANAGE_GUILD = bit(5n), MANAGE_ROLES = bit(28n), MANAGE_WEBHOOKS = bit(29n)
const MANAGE_EXPRESSIONS = bit(30n), MANAGE_EVENTS = bit(33n), CREATE_INVITE = bit(0n)
const SEND = bit(11n), REACT = bit(6n), EMBED = bit(14n)

const read = VIEW_CHANNEL | READ_HISTORY | VIEW_AUDIT_LOG
const moderator = read | KICK | BAN | MOD_MEMBERS | MANAGE_MESSAGES | MANAGE_THREADS
const manager = moderator | MANAGE_CHANNELS | MANAGE_GUILD | MANAGE_ROLES | MANAGE_WEBHOOKS | MANAGE_EXPRESSIONS | MANAGE_EVENTS | CREATE_INVITE | SEND | REACT | EMBED

export const PERMISSION_PRESETS = { read, moderator, manager, admin: bit(3n) } as const

export const buildInviteUrl = (clientId: string, preset: string | bigint): string => {
  const bits = typeof preset === 'bigint' ? preset : (PERMISSION_PRESETS as Record<string, bigint>)[preset]
  if (bits === undefined) throw new Error(`unknown preset "${preset}"; use ${Object.keys(PERMISSION_PRESETS).join(', ')} or a numeric bitfield`)
  const url = new URL('https://discord.com/oauth2/authorize')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('scope', 'bot')
  url.searchParams.set('permissions', bits.toString())
  return url.toString()
}
```

- [ ] **Step 3: Run, expect PASS. Commit.**
- [ ] **Step 4:** Failing tests then `config-loader.ts`: reads YAML via `yaml`, validates with `ConfigSchema`, formats issues as `guilds.<id>.max_tier: <message>`; test valid, missing file, invalid YAML, and multiple issues. Commit.
- [ ] **Step 5:** Failing tests then `logger.ts` (pino with `redact: ['*.token','*.access_token','*.refresh_token','*.client_secret','*.authorization','*.bot_token']`, `base: null`, timestamp ISO). Test: write to an in-memory stream, log an object with `token`, assert absent. Commit.
- [ ] **Step 6:** Failing tests then `check.ts` (`runCheck(opts): Promise<{ok: boolean; problems: string[]}>` validating config, env, and optionally opening the store in `:memory:`; `--online` flag additionally calls `DiscordPort.listBotGuildIds()` and checks each configured guild is present) and `main.ts` (argv parsing: default runs stdio server via `startServer` from C5; flags `--config`, `--http`, `--check`, `--online`, subcommand `invite-url --client-id <id> --permissions <preset|bits>`; client id defaults to `DISCORD_CLIENT_ID`). `main.ts` lands with a stub that imports `startServer` lazily so C4 can merge before C5. Commit `feat(cli): config loader, logger, check and invite-url commands`.

## Task C5: Server assembly (registry, MCP wiring, transports)

**Depends on:** C4, S3 (pipeline), T1 (tool defs), D1 (port), D4 (events), S4 (rules), S5-S6 (auth). Build against the interfaces first with fakes; final wiring after those merge.

**Files:**
- Create: `src/server/{registry,mcp,http,app,index}.ts`, `src/server/wiring.ts`
- Test: `tests/unit/server/*.test.ts`

**Interfaces:**
- Consumes: `runTool(deps, def, rawInput, principal, opts)` from `src/safety`; `allTools: AnyToolDef[]` from `src/tools`; `createDiscordPort(cfg)` and `createDiscordOAuthPort(cfg)` from `src/discord`; `createEventsService(store, port, cfg)` from `src/events`; `createRulesService(deps)` from `src/rules`; `createAuthProvider(deps)` and `createBearerMiddleware(deps)` from `src/auth`.
- Produces:
```ts
export const buildToolRegistry = (defs: AnyToolDef[], denied: string[]): Map<string, AnyToolDef>   // throws on duplicate names; adds optional confirm_token to destructive tools' input schema
export const createMcpServer = (deps: ServerDeps, principalFor: () => Principal): McpServer
export const startStdio = async (deps: ServerDeps): Promise<void>
export const startHttp = async (deps: ServerDeps): Promise<{ close(): Promise<void>; port: number }>
export const startServer = async (opts: { configPath: string; http: boolean }): Promise<void>
```

**Acceptance:**
- Registry rejects duplicate names; destructive tools accept `confirm_token`; denied tools are not registered.
- Every registered MCP tool call goes through `runTool`; `McpToolError` maps to an MCP tool result with `isError: true` and content JSON `{ "error": { "code", "message", "details" } }`. Unknown errors map to `internal` without stack trace.
- `confirm_required` result content includes `{ error: { code: 'confirm_required', details: { preview, confirm_token } } }`.
- stdio transport uses principal `{ kind: 'stdio', userId: null, userName: 'stdio', guilds: {} }`.
- HTTP: `POST/GET/DELETE /mcp` (streamable HTTP, stateless per request with a fresh server bound to the request's principal), `GET /healthz` returns `{ status, gateway, db }`; SIGINT/SIGTERM close gateway, HTTP server and store.
- Resource `discord://guild/{guild_id}/events` lists recent events and supports subscribe; notification `notifications/resources/updated` sent when the events service emits for that guild and the principal may read the guild.
- Access log line per HTTP request with `request_id`, `method`, `path`, `status`, `ip`, `latency`.

- [ ] **Step 1: Failing registry tests** (duplicate names throw; `confirm_token` added only to destructive tools; denied tools excluded).

```ts
it('adds confirm_token to destructive tools only', () => {
  const reg = buildToolRegistry([fakeTool('a_read', 'read'), fakeTool('b_del', 'destructive')], [])
  expect(reg.get('a_read')!.input.shape).not.toHaveProperty('confirm_token')
  expect(reg.get('b_del')!.input.shape).toHaveProperty('confirm_token')
})
```
- [ ] **Step 2:** Implement `registry.ts` with `def.input.extend({ confirm_token: z.string().optional() })` for destructive; run; commit.
- [ ] **Step 3:** Failing tests then `mcp.ts` using `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js` and an SDK `Client`: list tools, call a read tool, call a tool that throws `McpToolError('not_found')` and assert `isError` and JSON payload, call destructive tool without token and assert `confirm_required` payload. Use `server.registerTool(name, { description, inputSchema: def.input.shape }, cb)` and route through `runTool`. Commit.
- [ ] **Step 4:** Failing tests then events resource + subscription in `mcp.ts` (`server.server.setRequestHandler` for `resources/subscribe` if the SDK high-level API lacks it); test with the in-memory client that subscribing then appending an event via a fake events service triggers `resources/updated`. Commit.
- [ ] **Step 5:** Failing tests then `http.ts`: start on port 0 with express, `GET /healthz` returns 200, unauthenticated `POST /mcp` returns 401 with `WWW-Authenticate` including `resource_metadata`, service-token bearer succeeds `initialize`; mount `mcpAuthRouter`-based router from `src/auth` at root. Use `fetch` against the listening server. Commit.
- [ ] **Step 6:** `wiring.ts` + `startServer`: open store, build port and services, build registry, choose transport, graceful shutdown. Test shutdown closes resources (fakes with spies). Run `pnpm check`. Commit `feat(server): mcp server assembly with stdio and http transports`.

## Task C6: README, getting-started, smoke checklist

**Depends on:** C5 (commands final)

**Files:**
- Create: `README.md`, `docs/getting-started.md`, `docs/smoke-checklist.md`
- Test: `tests/unit/docs/docs.test.ts`

**Acceptance:** `docs/getting-started.md` contains every step from spec §13.1 in order; a test asserts the doc mentions each required env var, the `invite-url`, `--check`, `claude mcp add` (stdio and `--transport http`) strings, and that every relative link in the README/docs resolves to an existing file.

- [ ] **Step 1:** Write the failing docs test (reads files, asserts required strings and link targets).
- [ ] **Step 2:** Run, expect FAIL. Write the three documents: README (what it is, quickstart, tool group table, safety model, config reference linking `config.example.yaml`, development commands), getting-started (spec §13.1 steps, with the bot-required explanation), smoke checklist (manual run against a throwaway guild: read tool, write tool, destructive preview then confirm, rule trigger, event poll, OAuth login, non-admin denied, revoke).
- [ ] **Step 3:** Run, expect PASS; `pnpm check`; commit `docs: readme, getting started and smoke checklist`.

---

# Part B: `discord`

Owner tree: `src/discord/`, `src/events/`, `tests/unit/{discord,events}/`. `discord.js` is imported only here.

`GatewayPort` and `GatewayStatus` are defined in C2 (`src/contracts/discord-port.ts`); shown here for reference:
```ts
export type GatewayStatus = 'connecting' | 'ready' | 'disconnected'
export interface GatewayPort {
  start(): Promise<void>
  stop(): Promise<void>
  onEvent(cb: (e: NewEvent) => void): () => void
  onStatus(cb: (s: GatewayStatus) => void): () => void
  status(): GatewayStatus
}
```

## Task D1: Discord client, REST helper, error mapping, OAuth port

**Depends on:** C2

**Files:**
- Create: `src/discord/{client,errors,rest,oauth,index}.ts`
- Test: `tests/unit/discord/{errors,rest,oauth}.test.ts`

**Interfaces:**
- Produces:
```ts
export const mapDiscordError = (err: unknown): McpToolError
export interface Rest { get<T>(route: string, o?: RestOpts): Promise<T>; post<T>(...): Promise<T>; patch<T>(...): Promise<T>; put<T>(...): Promise<T>; delete<T>(...): Promise<T> }
export interface RestOpts { body?: unknown; query?: Record<string, string | number | undefined>; reason?: string; auth?: boolean; files?: { name: string; data: Buffer; contentType?: string }[] }
export const createRest = (botToken: string, fetchImpl?: typeof fetch): Rest        // wraps discord.js REST; every failure passes through mapDiscordError
export const createDiscordOAuthPort = (o: { clientId: string; clientSecret: string; fetchImpl?: typeof fetch }): DiscordOAuthPort
export const createDiscordPort = (o: { botToken: string; rest?: Rest }): DiscordPort   // assembled in D3
```
- Error mapping: HTTP 404 or Discord code 10xxx -> `not_found`; 403 or code 50001/50013 -> `missing_permissions`; 400 -> `invalid_input` (message from Discord); 429 -> `rate_limited` with `details.retry_after` seconds; everything else -> `internal` with a generic message (never leak tokens or headers).
- OAuth port: `exchangeCode` posts `grant_type=authorization_code` form to `https://discord.com/api/oauth2/token` with `client_id`, `client_secret`, `code`, `redirect_uri`; `fetchUser` GET `/users/@me`; `fetchUserGuilds` GET `/users/@me/guilds` with Bearer token (paginate not required; Discord returns up to 200; document the limitation).

**Acceptance:** tests use an injected fake `fetch` / discord.js `DiscordAPIError` instances; secrets (`client_secret`, tokens) never appear in thrown error messages (assert with a string search).

- [ ] **Step 1:** Failing tests for `mapDiscordError` with `new DiscordAPIError({ message, code }, code, status, method, url, {})` for statuses 404, 403 (code 50013), 400, and a `RateLimitError`-shaped object; plus a generic `Error('boom')` mapping to `internal` with message `internal error`.
- [ ] **Step 2:** Implement `errors.ts`; run; commit.
- [ ] **Step 3:** Failing tests for `createRest`: builds request with bot auth, forwards `reason` as `X-Audit-Log-Reason` (via discord.js `reason`), `query` params, and maps thrown errors. Mock by passing `rest` override of discord.js `REST` through a `fetchImpl` returning canned `Response`s. Implement `rest.ts`/`client.ts` using `new REST({ version: '10', makeRequest: adapt(fetchImpl) }).setToken(botToken)`; set `rejectOnRateLimit: () => true` only for routes matching bulk; otherwise let discord.js queue. Commit.
- [ ] **Step 4:** Failing tests then `oauth.ts` (`exchangeCode` form-encodes body, does not log secret, non-200 maps to `unauthorized` with generic message; `fetchUser`/`fetchUserGuilds` send `Authorization: Bearer`). Commit `feat(discord): rest helper, error mapping and oauth port`.

## Task D2: DiscordPort methods, part 1 (guild, channels, threads, roles, members)

**Depends on:** D1

**Files:**
- Create: `src/discord/port-guild.ts`, `src/discord/port-channels.ts`, `src/discord/port-roles-members.ts`
- Test: `tests/unit/discord/port-{guild,channels,roles-members}.test.ts`

**Interfaces:**
- Consumes: `Rest` from D1, `DiscordPort` method names from C2.
- Produces: `guildMethods(rest): Pick<DiscordPort, ...>`, `channelMethods(rest)`, `roleMemberMethods(rest)`; D3 spreads them into the final object.

**Acceptance:** for every method below, a test asserts the exact HTTP verb, route, query/body and `reason` forwarded, using a recording fake `Rest`. Use discord.js `Routes.*` helpers where one exists for the route, so routes track the installed API version; the routes below are the expected result.

| Port method | Verb and route | Notes |
|---|---|---|
| `listBotGuildIds` | GET `/users/@me/guilds?limit=200` | page with `after` until fewer than 200 |
| `fetchMemberPermissions(g,u)` | GET `/guilds/{g}`, `/guilds/{g}/roles`, `/guilds/{g}/members/{u}` | owner -> `((1n<<50n)-1n).toString()`; else OR of `@everyone` role and member roles; if ADMINISTRATOR bit set return all-ones; return decimal string; missing member -> `not_found` |
| `getGuild` / `listGuilds` | GET `/guilds/{g}?with_counts=true` / `/users/@me/guilds` | |
| `updateGuild` | PATCH `/guilds/{g}` | |
| `getGuildPreview` | GET `/guilds/{g}/preview` | |
| `getPruneCount` / `pruneGuild` | GET `/guilds/{g}/prune?days=` / POST `/guilds/{g}/prune` body `{days, compute_prune_count: true}` | |
| `getWidget` / `updateWidget` | GET / PATCH `/guilds/{g}/widget` | |
| `listChannels` / `getChannel` | GET `/guilds/{g}/channels` / `/channels/{c}` | |
| `createChannel` | POST `/guilds/{g}/channels` | |
| `updateChannel` / `deleteChannel` | PATCH / DELETE `/channels/{c}` | |
| `moveChannels` | PATCH `/guilds/{g}/channels` body array | |
| `setChannelPermissions` / `deleteChannelPermissions` | PUT / DELETE `/channels/{c}/permissions/{o}` | |
| `listActiveThreads` | GET `/guilds/{g}/threads/active` | return `.threads` |
| `listArchivedThreads` | GET `/channels/{c}/threads/archived/{public\|private}?before&limit` | return `.threads` |
| `createThread` | POST `/channels/{c}/messages/{m}/threads` if `message_id` given, else POST `/channels/{c}/threads` | strip `message_id` from body |
| `createForumPost` | POST `/channels/{c}/threads` | body includes `message` |
| `addThreadMember` / `removeThreadMember` | PUT / DELETE `/channels/{t}/thread-members/{u}` | |
| `listRoles` / `createRole` | GET / POST `/guilds/{g}/roles` | |
| `updateRole` / `deleteRole` | PATCH / DELETE `/guilds/{g}/roles/{r}` | |
| `reorderRoles` | PATCH `/guilds/{g}/roles` body array | |
| `listMembers` / `getMember` / `searchMembers` | GET `/guilds/{g}/members?limit&after` / `.../members/{u}` / `.../members/search?query&limit` | |
| `updateMember` | PATCH `/guilds/{g}/members/{u}` | used for nick, roles, voice move (`channel_id`, null disconnects), timeout (`communication_disabled_until`) |
| `addMemberRole` / `removeMemberRole` | PUT / DELETE `/guilds/{g}/members/{u}/roles/{r}` | |

Reference test pattern (copy for every row):
```ts
const calls: Call[] = []
const rest = recordingRest(calls, { '/guilds/1/roles': [{ id: '9' }] })
const m = roleMemberMethods(rest)
await m.listRoles('1')
expect(calls).toEqual([{ verb: 'get', route: '/guilds/1/roles' }])
```

- [ ] **Step 1:** Write `tests/unit/discord/helpers.ts` with `recordingRest(calls, responses)` returning a `Rest` that records `{verb, route, query, body, reason}` and returns canned data by route.
- [ ] **Step 2:** Failing tests for guild methods (all rows), including the permissions computation cases: owner, administrator role, plain roles OR-ed with `@everyone`, missing member. Implement `port-guild.ts`; commit.
- [ ] **Step 3:** Failing tests then `port-channels.ts` (channels, permissions, threads, forum rows); commit.
- [ ] **Step 4:** Failing tests then `port-roles-members.ts`; commit. Run `pnpm check`.

## Task D3: DiscordPort methods, part 2, and port assembly

**Depends on:** D2

**Files:**
- Create: `src/discord/port-moderation.ts`, `src/discord/port-messages.ts`, `src/discord/port-misc.ts`, `src/discord/rest-port.ts`
- Modify: `src/discord/index.ts`
- Test: `tests/unit/discord/port-{moderation,messages,misc}.test.ts`, `tests/unit/discord/assembly.test.ts`

**Interfaces:**
- Produces: final `createDiscordPort({ botToken, rest? }): DiscordPort` spreading all method groups; a type-level test asserts the returned object satisfies `DiscordPort` (no missing methods).

| Port method | Verb and route | Notes |
|---|---|---|
| `kickMember` | DELETE `/guilds/{g}/members/{u}` | |
| `banMember` | PUT `/guilds/{g}/bans/{u}` body `{delete_message_seconds}` | |
| `unbanMember` | DELETE `/guilds/{g}/bans/{u}` | |
| `bulkBan` | POST `/guilds/{g}/bulk-ban` body `{user_ids, delete_message_seconds}` | |
| `listBans` | GET `/guilds/{g}/bans?limit&after` | |
| automod: list, create, update, delete | `/guilds/{g}/auto-moderation/rules[/{id}]` | |
| `listMessages` | GET `/channels/{c}/messages?limit&before&after` | |
| `getMessage` / `sendMessage` / `editMessage` / `deleteMessage` | `/channels/{c}/messages[/{m}]` | |
| `bulkDeleteMessages` | POST `/channels/{c}/messages/bulk-delete` body `{messages}` | 2-100 ids per call; port chunks into batches of 100; ids older than 14 days are deleted one by one via `deleteMessage`, decided by snowflake timestamp |
| `pinMessage` / `unpinMessage` / `listPins` | use `Routes.channelPin`/`Routes.channelPins` | |
| `crosspostMessage` | POST `/channels/{c}/messages/{m}/crosspost` | |
| `addReaction` / `removeReaction` / `clearReactions` | `/channels/{c}/messages/{m}/reactions[/{emoji}/@me or /{userId}]` | emoji is `encodeURIComponent` |
| webhooks | list `/guilds/{g}/webhooks` or `/channels/{c}/webhooks`; create POST `/channels/{c}/webhooks`; update PATCH `/webhooks/{w}`; delete DELETE `/webhooks/{w}`; execute POST `/webhooks/{w}/{token}?wait=true` with `auth: false` | |
| scheduled events | `/guilds/{g}/scheduled-events[/{id}]`, users `.../{id}/users?limit=` | `listScheduledEvents` adds `with_user_count=true` |
| invites | GET `/guilds/{g}/invites`; POST `/channels/{c}/invites`; DELETE `/invites/{code}` | |
| emojis | `/guilds/{g}/emojis[/{id}]` | `image` is a data URI |
| stickers | GET `/guilds/{g}/stickers`; POST multipart `/guilds/{g}/stickers` with `files`; DELETE `/guilds/{g}/stickers/{id}` | `file` is base64 |
| `listAuditLog` | GET `/guilds/{g}/audit-logs?user_id&action_type&limit&before` | |

**Acceptance:** same recording-`Rest` route tests for every row; the bulk delete chunking and old-message fallback are unit-tested (fake snowflakes older and newer than 14 days); assembly test proves every key of `DiscordPort` is implemented (use a `satisfies DiscordPort` check plus a runtime key list generated from the interface in the test).

- [ ] **Step 1:** Failing tests then `port-moderation.ts`; commit.
- [ ] **Step 2:** Failing tests then `port-messages.ts`, including bulk-delete edge cases: 1 id (single delete), 250 ids (3 batches), mix of old and new ids; commit.
- [ ] **Step 3:** Failing tests then `port-misc.ts` (webhooks, scheduled events, invites, emojis, stickers, audit log); commit.
- [ ] **Step 4:** Failing assembly test then `rest-port.ts` and update `src/discord/index.ts` to export `createDiscordPort`, `createDiscordOAuthPort`, `createGateway` (from D4), `mapDiscordError`. Run `pnpm check`; commit `feat(discord): complete DiscordPort over REST`.

## Task D4: Gateway client and event normalization

**Depends on:** D1

**Files:**
- Create: `src/discord/gateway.ts`, `src/discord/normalize.ts`
- Test: `tests/unit/discord/normalize.test.ts`, `tests/unit/discord/gateway.test.ts`

**Interfaces:**
- Produces:
```ts
export const createGateway = (o: { botToken: string; messageContent: boolean; client?: GatewayClientLike }): GatewayPort
export const normalizeGatewayEvent: { [K in EventType]?: (...args: never[]) => NewEvent | null }   // one pure function per discord.js event
```
- Intents: `Guilds`, `GuildMembers`, `GuildModeration`, `GuildMessages`, `GuildVoiceStates`, `GuildScheduledEvents`; plus `MessageContent` only when `messageContent` is true.

Normalized `data` shapes (rules and tools rely on these exact keys):

| Event | discord.js source | `data` |
|---|---|---|
| `message_create` | `messageCreate` | `{ message_id, channel_id, author_id, author_is_bot, attachments_count, content? }` (`content` only if `messageContent`) |
| `message_update` | `messageUpdate` | same shape, from the new message |
| `message_delete` | `messageDelete` | `{ message_id, channel_id }` |
| `member_join` | `guildMemberAdd` | `{ user_id, username, account_created_at, roles: string[] }` |
| `member_remove` | `guildMemberRemove` | `{ user_id, username, roles: string[] }` |
| `member_ban` / `member_unban` | `guildBanAdd` / `guildBanRemove` | `{ user_id, username }` |
| `role_create` / `role_update` / `role_delete` | `roleCreate` / `roleUpdate` / `roleDelete` | `{ role_id, name }` |
| `channel_create` / `channel_update` / `channel_delete` | `channelCreate` / `channelUpdate` / `channelDelete` | `{ channel_id, name, type }` |
| `voice_state` | `voiceStateUpdate` | `{ user_id, old_channel_id, new_channel_id }` |
| `scheduled_event` | `guildScheduledEventCreate/Update/Delete` | `{ event_id, name, action: 'create'\|'update'\|'delete' }` |

All events carry `guildId` and ISO `at`. Bot's own messages are still emitted (`author_is_bot` true) so rules can filter. Partial objects are normalized with nulls instead of throwing.

**Acceptance:** each normalizer has a test from a minimal discord.js-shaped fixture; `content` omitted when the intent flag is off even if the fixture has it; status callbacks fire `connecting -> ready -> disconnected -> ready` using a fake client emitting `ready`, `shardDisconnect`, `shardResume`; `stop()` destroys the client and unsubscribes.

- [ ] **Step 1:** Failing normalizer tests (table-driven over the rows above); implement `normalize.ts`; commit.
- [ ] **Step 2:** Failing gateway tests with a `FakeClient extends EventEmitter` (`login`, `destroy`); implement `gateway.ts` wiring intents, listeners, status transitions, and `onEvent`/`onStatus` unsubscribe functions; commit `feat(discord): gateway client with normalized events`.

## Task D5: Events service (buffer, gaps, polling, subscriptions)

**Depends on:** C3, D4 (type `GatewayPort` only, so it can start after C3 using a fake gateway)

**Files:**
- Create: `src/events/service.ts`, `src/events/index.ts`
- Test: `tests/unit/events/service.test.ts`

**Interfaces:**
- Produces:
```ts
export interface EventsService extends EventsPort {
  start(): void
  stop(): void
  subscribe(cb: (e: NormalizedEvent) => void): () => void
  recent(guildId: string, limit: number): NormalizedEvent[]
}
export const createEventsService = (d: {
  store: Store
  gateway: GatewayPort
  config: Pick<Config, 'events'>
  guildIds: string[]
  canRead: (p: Principal, guildId: string) => boolean
  now?: () => number
}): EventsService
```
- Behavior: `start()` subscribes to gateway events (ignores events for guilds not in `guildIds`), appends each to the store, then notifies subscribers with the stored (id-bearing) event; on status `disconnected -> ready`, appends a `gap` event per guild in `guildIds`; prunes every 10 minutes and after every 1000 appends using `config.events`; `poll` throws `guild_not_allowed` when `!canRead`, clamps `limit` to 1..500, returns ascending events after `sinceId` with optional `types`.

**Acceptance:** tests cover ordering and monotonic ids, filtering by type, unknown guild ignored, gap marker after reconnect, pruning by age and by max rows (fake clock), subscription notify and unsubscribe, `poll` denial, `stop()` idempotent.

- [ ] **Step 1:** Failing tests with `FakeGateway` (in the test file) and `openStore(':memory:')`; **Step 2:** implement; **Step 3:** `pnpm check`; commit `feat(events): buffered event service with gap markers`.

---

# Part C: `tools`

Owner tree: `src/tools/`, `tests/unit/tools/`. Tools may import only `src/contracts`.

**Common rules for every tool** (enforced later by the contract tests in Q2):
- `name` matches `^[a-z][a-z0-9_]*$`, unique, starts with its group prefix; `description` states target, effect and tier in one or two sentences.
- Every input has `guild_id` (snowflake) **except** the meta tools that are explicitly listed as unscoped. Even when a route uses a channel, webhook or invite id, `guildFrom` returns `input.guild_id`, and the handler **and** preview verify the resource belongs to that guild with `assertChannelInGuild`, `assertWebhookInGuild` or `assertInviteInGuild` (from T1) before doing anything else. This prevents using an allowed guild id to act on a resource in a guild outside the allowlist.
- Handlers use `ctx.discord` only. Audit-log `reason` is `"via discord-mcp by <principal.userName> (<correlationId>)"`, built by `auditReason(ctx)`.
- Return `{ data: <Dto or summary object> }`; lists return `{ data: { items: [...], next_cursor?: string } }` where a cursor exists.
- Destructive tools implement `preview` (no mutating port calls) and return `{ summary, affected, details? }`.
- Test every tool with mocked `ctx.discord`: correct port call and args, input validation failures, guild-binding rejection, and for destructive tools that `preview` performs zero mutating calls.

## Task T1: Tool helpers, registry index, guild and channel tools

**Depends on:** C2

**Files:**
- Create: `src/tools/define.ts`, `src/tools/index.ts`, `src/tools/guild.ts`, `src/tools/channels.ts`, and empty-array stubs for every other group file: `threads.ts roles.ts members.ts moderation.ts messages.ts webhooks.ts scheduled-events.ts invites.ts emojis.ts audit-log.ts meta.ts` (each `export const <group>Tools: AnyToolDef[] = []`)
- Test: `tests/unit/tools/{helpers.ts,define.test.ts,guild.test.ts,channels.test.ts}`

**Interfaces:**
- Produces:
```ts
export const snowflake: z.ZodString                 // /^\d{17,20}$/
export const guildId: z.ZodString                   // snowflake with description "Target guild id"
export const defineTool: <S extends z.ZodRawShape>(def: {
  name: string; group: string; description: string; tier: Tier
  unscoped?: boolean                                 // true only for read tools whose guildFrom returns null
  input: S
  guildFrom: (i: z.infer<z.ZodObject<S>>) => string | null
  preview?: (ctx: ToolContext, i: z.infer<z.ZodObject<S>>) => Promise<PreviewResult>
  handler: (ctx: ToolContext, i: z.infer<z.ZodObject<S>>) => Promise<ToolResult>
}) => AnyToolDef
export const auditReason: (ctx: ToolContext) => string
export const assertChannelInGuild: (ctx: ToolContext, channelId: string, guildId: string) => Promise<Dto>   // throws McpToolError('not_found') on mismatch (never reveals the real guild)
export const assertWebhookInGuild: (ctx: ToolContext, webhookId: string, guildId: string) => Promise<Dto>
export const assertInviteInGuild: (ctx: ToolContext, code: string, guildId: string) => Promise<Payload>
export const allTools: AnyToolDef[]                 // in src/tools/index.ts: concatenation of every group array
```
- Test helper `makeCtx(overrides?: Partial<ToolContext> & { discord?: Partial<DiscordPort> })` returning a ctx whose `discord` is a Proxy that throws `unexpected call: <method>` for anything not provided and records calls, so previews can be asserted to make no mutating calls.

**Acceptance:** `defineTool` output is a valid `AnyToolDef` (`input` is a `z.ZodObject`); the three assert helpers reject a mismatched guild with `not_found`; `guild_*` and `channels_*` tools below pass their tests.

- [ ] **Step 1: Failing tests for helpers**

```ts
it('assertChannelInGuild rejects channel from another guild', async () => {
  const ctx = makeCtx({ discord: { getChannel: async () => ({ id: '2'.repeat(18), guild_id: '9'.repeat(18) }) } })
  await expect(assertChannelInGuild(ctx, '2'.repeat(18), '1'.repeat(18))).rejects.toMatchObject({ code: 'not_found' })
})
it('defineTool wraps shape into a zod object', () => {
  const t = defineTool({ name: 'x_y', group: 'x', description: 'd', tier: 'read', input: { guild_id: guildId }, guildFrom: (i) => i.guild_id, handler: async () => ({ data: 1 }) })
  expect(t.input.safeParse({ guild_id: '1'.repeat(18) }).success).toBe(true)
  expect(t.input.safeParse({ guild_id: 'abc' }).success).toBe(false)
})
```
- [ ] **Step 2:** Run, expect FAIL; implement `define.ts`; `index.ts` (imports each `*Tools` array, exports `allTools`); stub group files; commit.
- [ ] **Step 3: Reference implementations** (copy this pattern for every tool). Read tool:

```ts
export const guildGet = defineTool({
  name: 'guild_get', group: 'guild', tier: 'read',
  description: 'Get details of a guild (read).',
  input: { guild_id: guildId },
  guildFrom: (i) => i.guild_id,
  handler: async (ctx, i) => ({ data: await ctx.discord.getGuild(i.guild_id) }),
})
```
Destructive tool with preview and guild binding:
```ts
export const channelsDelete = defineTool({
  name: 'channels_delete', group: 'channels', tier: 'destructive',
  description: 'Delete a channel and its messages permanently (destructive).',
  input: { guild_id: guildId, channel_id: snowflake },
  guildFrom: (i) => i.guild_id,
  preview: async (ctx, i) => {
    const ch = await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { summary: `Delete channel #${String(ch.name)} (${i.channel_id})`, affected: { channels: 1 }, details: { name: ch.name, type: ch.type } }
  },
  handler: async (ctx, i) => {
    await assertChannelInGuild(ctx, i.channel_id, i.guild_id)
    return { data: await ctx.discord.deleteChannel(i.channel_id, auditReason(ctx)) }
  },
})
```
- [ ] **Step 4: `guild` tools** (failing tests, implement, commit):

| Tool | Tier | Input (besides `guild_id`) | Port call |
|---|---|---|---|
| `guild_list` | read | none; `guildFrom` returns `null`; result filtered to `Object.keys(ctx.services.policy.effective(ctx.principal).guilds)` | `listGuilds` |
| `guild_get` | read | | `getGuild` |
| `guild_update` | write | `name?`, `description?`, `verification_level? (0-4)`, `system_channel_id?` | `updateGuild` |
| `guild_get_preview` | read | | `getGuildPreview` |
| `guild_get_prune_count` | read | `days` 1-30 | `getPruneCount` |
| `guild_prune` | destructive | `days` 1-30; preview reports `getPruneCount` result as `affected.members` | `pruneGuild` |
| `guild_get_widget` | read | | `getWidget` |
| `guild_update_widget` | write | `enabled?`, `channel_id?` | `updateWidget` |

- [ ] **Step 5: `channels` tools** (failing tests, implement, commit):

| Tool | Tier | Input | Port call |
|---|---|---|---|
| `channels_list` | read | | `listChannels` |
| `channels_get` | read | `channel_id` | `assertChannelInGuild` |
| `channels_create` | write | `name` 1-100, `type` enum (0 text, 2 voice, 4 category, 5 announcement, 13 stage, 15 forum), `parent_id?`, `topic?`, `nsfw?`, `position?` | `createChannel` |
| `channels_update` | write | `channel_id`, `name?`, `topic?`, `nsfw?`, `parent_id?`, `rate_limit_per_user?`, `available_tags?` (forum) | `updateChannel` |
| `channels_move` | write | `positions[]` of `{id, position, parent_id?}` max 50 | `moveChannels` |
| `channels_set_permissions` | write | `channel_id`, `overwrite_id`, `type` (0 role, 1 member), `allow`, `deny` (decimal bit strings) | `setChannelPermissions` |
| `channels_delete_permissions` | write | `channel_id`, `overwrite_id` | `deleteChannelPermissions` |
| `channels_delete` | destructive | `channel_id` (reference above) | `deleteChannel` |
| `channels_clone` | write | `channel_id`, `name?` (copies type, topic, parent, permission overwrites) | `getChannel` then `createChannel` |

- [ ] **Step 6:** `pnpm check`; commit `feat(tools): helpers, guild and channel tools`.

## Task T2: Threads, forum and roles

**Depends on:** T1

**Files:** Modify `src/tools/threads.ts`, `src/tools/roles.ts`; Test `tests/unit/tools/{threads,roles}.test.ts`

| Tool | Tier | Input | Port call |
|---|---|---|---|
| `threads_list_active` | read | | `listActiveThreads` |
| `threads_list_archived` | read | `channel_id`, `kind` public/private, `before?`, `limit? 1-100` | `listArchivedThreads` |
| `threads_create` | write | `channel_id`, `name`, `message_id?`, `type?` (11 public, 12 private), `auto_archive_duration?` (60,1440,4320,10080) | `createThread` |
| `threads_update` | write | `thread_id`, `name?`, `archived?`, `locked?` | `updateChannel` (thread ids are channels; guard with `assertChannelInGuild`) |
| `threads_add_member` / `threads_remove_member` | write | `thread_id`, `user_id` | `addThreadMember` / `removeThreadMember` |
| `threads_delete` | destructive | `thread_id`; preview names thread and message count if known | `deleteChannel` |
| `forum_create_post` | write | `channel_id`, `name`, `content`, `applied_tags?` | `createForumPost` (body `{ name, applied_tags, message: { content } }`) |
| `forum_list_tags` | read | `channel_id` | `getChannel` -> `available_tags` |
| `forum_update_tags` | write | `channel_id`, `tags[]` of `{id?, name, emoji_name?, moderated?}` | `updateChannel({ available_tags })` |
| `roles_list` | read | | `listRoles` |
| `roles_get` | read | `role_id` | `listRoles` then find; `not_found` if absent |
| `roles_create` | write | `name`, `color?`, `permissions?` (decimal string), `hoist?`, `mentionable?` | `createRole` |
| `roles_update` | write | `role_id`, same optional fields | `updateRole` |
| `roles_reorder` | write | `positions[]` of `{id, position}` max 50 | `reorderRoles` |
| `roles_assign` / `roles_remove` | write | `user_id`, `role_id` | `addMemberRole` / `removeMemberRole` |
| `roles_bulk_assign` | destructive | `role_id`, `user_ids[]` max 200; preview lists count and role name; handler assigns sequentially and returns `{ ok: [...], failed: [{user_id, code}] }` | `addMemberRole` |
| `roles_delete` | destructive | `role_id`; preview reports the number of members holding the role (from `listMembers` scan up to 1000) | `deleteRole` |

- [ ] **Step 1-3:** For threads/forum: failing tests (port call args, validation, guild binding, thread delete preview has no mutating calls), implement, commit. **Step 4-6:** same for roles including the 200-target cap test (201 ids rejected by schema) and partial failure reporting; `pnpm check`; commit `feat(tools): threads, forum and role tools`.

## Task T3: Members and moderation

**Depends on:** T1

**Files:** Modify `src/tools/members.ts`, `src/tools/moderation.ts`; Test `tests/unit/tools/{members,moderation}.test.ts`

| Tool | Tier | Input | Port call |
|---|---|---|---|
| `members_list` | read | `limit? 1-1000 default 100`, `after?` | `listMembers` |
| `members_get` | read | `user_id` | `getMember` |
| `members_search` | read | `query` 1-100, `limit? 1-100` | `searchMembers` |
| `members_update_nick` | write | `user_id`, `nick` (null clears) | `updateMember({ nick })` |
| `members_add_role` / `members_remove_role` | write | `user_id`, `role_id` | `addMemberRole` / `removeMemberRole` |
| `members_move_voice` | write | `user_id`, `channel_id` | `updateMember({ channel_id })` with `assertChannelInGuild` |
| `members_disconnect_voice` | write | `user_id` | `updateMember({ channel_id: null })` |
| `mod_timeout` | write | `user_id`, `duration_seconds` 1-2419200 | `updateMember({ communication_disabled_until: <iso> })` |
| `mod_remove_timeout` | write | `user_id` | `updateMember({ communication_disabled_until: null })` |
| `mod_kick` | destructive | `user_id`, `reason?`; preview fetches member for display name | `kickMember` |
| `mod_ban` | destructive | `user_id`, `delete_message_seconds? 0-604800`, `reason?` | `banMember` |
| `mod_unban` | write | `user_id`, `reason?` | `unbanMember` |
| `mod_bulk_ban` | destructive | `user_ids[]` 1-200, `delete_message_seconds?`, `reason?`; result includes `failed_users` | `bulkBan` |
| `mod_list_bans` | read | `limit? 1-1000`, `after?` | `listBans` |
| `automod_list_rules` | read | | `listAutomodRules` |
| `automod_create_rule` | write | `name`, `event_type` (1), `trigger_type` (1,3,4,5,6), `trigger_metadata?`, `actions[]`, `enabled?`, `exempt_roles?`, `exempt_channels?` | `createAutomodRule` |
| `automod_update_rule` | write | `rule_id` + optional fields | `updateAutomodRule` |
| `automod_delete_rule` | destructive | `rule_id` | `deleteAutomodRule` |

- [ ] **Step 1-3:** members tests, implementation, commit. **Step 4-6:** moderation tests including `mod_timeout` ISO math with an injected clock (accept `ctx.now?` or `Date.now` stubbed with `vi.useFakeTimers`), bulk ban cap (201 rejected), preview makes no mutating call, reason forwarded; implement; `pnpm check`; commit `feat(tools): member and moderation tools`.

## Task T4: Messages and reactions

**Depends on:** T1

**Files:** Modify `src/tools/messages.ts`; Test `tests/unit/tools/messages.test.ts`

Every tool takes `guild_id`, `channel_id` and calls `assertChannelInGuild` first.

| Tool | Tier | Input | Port call |
|---|---|---|---|
| `messages_list` | read | `limit? 1-100`, `before?`, `after?` | `listMessages` |
| `messages_get` | read | `message_id` | `getMessage` |
| `messages_send` | write | `content?` <=2000, `embeds?` <=10, `reply_to?`, `allowed_mentions?` default `{ parse: [] }` (no mass pings unless explicitly set); at least one of content/embeds | `sendMessage` |
| `messages_edit` | write | `message_id`, `content?`, `embeds?` | `editMessage` |
| `messages_delete` | destructive | `message_id`; preview shows author and first 100 chars | `deleteMessage` |
| `messages_purge` | destructive | `limit` 1-1000, `before?`, `user_id?`, `contains?`; preview scans and reports `affected.messages`; handler deletes the same set via `bulkDeleteMessages`; hard cap 1000 | `listMessages` (paged), `bulkDeleteMessages` |
| `messages_pin` / `messages_unpin` | write | `message_id` | `pinMessage` / `unpinMessage` |
| `messages_list_pins` | read | | `listPins` |
| `messages_crosspost` | write | `message_id` | `crosspostMessage` |
| `reactions_add` / `reactions_remove` | write | `message_id`, `emoji`, `user_id?` (remove only) | `addReaction` / `removeReaction` |
| `reactions_clear` | destructive | `message_id` | `clearReactions` |
| `messages_search` | read | `query`, `author_id?`, `max_scan? <=500 default 200`; client-side filter over paged `listMessages` (Discord gives bots no search endpoint); result notes `scanned` count | `listMessages` |

- [ ] **Step 1-2:** Failing tests: cap enforcement (limit 1001 rejected), purge scan/preview/delete consistency with a fake of 250 messages across pages, mentions default, search scan limit, reaction emoji passthrough; implement; `pnpm check`; commit `feat(tools): message and reaction tools`.

## Task T5: Webhooks, scheduled events, invites, emojis and stickers

**Depends on:** T1

**Files:** Modify `src/tools/{webhooks,scheduled-events,invites,emojis}.ts`; Test `tests/unit/tools/{webhooks,scheduled-events,invites,emojis}.test.ts`

| Tool | Tier | Input | Port call / guard |
|---|---|---|---|
| `webhooks_list` | read | `channel_id?` | `listWebhooks({channelId})` (with `assertChannelInGuild`) or `{guildId}` |
| `webhooks_create` | write | `channel_id`, `name` | `createWebhook` |
| `webhooks_update` | write | `webhook_id`, `name?`, `channel_id?` | `assertWebhookInGuild` then `updateWebhook` |
| `webhooks_execute` | write | `webhook_id`, `content`, `username?`; token is read from the webhook object (`assertWebhookInGuild` returns it), never accepted as input, never logged | `executeWebhook` |
| `webhooks_delete` | destructive | `webhook_id` | `deleteWebhook` |
| `sevents_list` / `sevents_get` | read | `event_id` (get) | `listScheduledEvents` / `getScheduledEvent` |
| `sevents_create` | write | `name`, `scheduled_start_time` (ISO), `scheduled_end_time?`, `entity_type` (1 stage, 2 voice, 3 external), `channel_id?`, `entity_metadata?`, `description?`, `privacy_level` fixed 2 | `createScheduledEvent` |
| `sevents_update` | write | `event_id` + optional fields, `status?` | `updateScheduledEvent` |
| `sevents_list_users` | read | `event_id`, `limit? 1-100` | `listScheduledEventUsers` |
| `sevents_delete` | destructive | `event_id` | `deleteScheduledEvent` |
| `invites_list` | read | | `listInvites` |
| `invites_create` | write | `channel_id`, `max_age? <=604800`, `max_uses? <=100`, `temporary?`, `unique?` | `createInvite` |
| `invites_delete` | destructive | `code` | `assertInviteInGuild` then `deleteInvite` |
| `emojis_list` / `stickers_list` | read | | `listEmojis` / `listStickers` |
| `emojis_create` | write | `name` 2-32, `image` (data URI, max 256 KB) | `createEmoji` |
| `emojis_update` | write | `emoji_id`, `name?`, `roles?` | `updateEmoji` |
| `emojis_delete` / `stickers_delete` | destructive | `emoji_id` / `sticker_id` | `deleteEmoji` / `deleteSticker` |
| `stickers_create` | write | `name`, `description`, `tags`, `file` (base64 png/apng/json, max 512 KB) | `createSticker` |

- [ ] **Step 1-4:** Failing tests then implementation per file, including: webhook token never present in any returned `data` and never passed to `ctx.logger` (assert with spy), guild-binding rejections for webhook and invite, size limits on emoji/sticker payloads, ISO date validation; `pnpm check`; commit `feat(tools): webhook, event, invite, emoji and sticker tools`.

## Task T6: Audit log, meta tools, registry checks

**Depends on:** T1, C2 (`Services` contract)

**Files:** Modify `src/tools/{audit-log,meta,index}.ts`; Test `tests/unit/tools/{audit-log,meta,index}.test.ts`

| Tool | Tier | Input | Implementation |
|---|---|---|---|
| `audit_log_list` | read | `limit? 1-100`, `before?` | `listAuditLog` |
| `audit_log_by_user` | read | `user_id`, `limit?` | `listAuditLog({ user_id })` |
| `audit_log_by_action` | read | `action_type` int, `limit?` | `listAuditLog({ action_type })` |
| `server_whoami` | read | none (unscoped, `guildFrom` null) | returns principal `{ kind, user_id, user_name }` and guild ids |
| `server_policy` | read | none (unscoped) | `ctx.services.policy.effective(ctx.principal)` |
| `events_poll` | read | `guild_id`, `since_id? default 0`, `types?`, `limit? 1-500 default 100` | `ctx.services.events.poll` |
| `rules_create` | write | `RuleInputSchema` fields (guild_id included) | `ctx.services.rules.create` |
| `rules_list` | read | `guild_id` | `rules.list` |
| `rules_update` | write | `guild_id`, `rule_id`, partial `RuleInput` | `rules.update` |
| `rules_delete` | write | `guild_id`, `rule_id` | `rules.remove` |
| `rules_test` | read | `guild_id`, `rule_id`, `sample_event` (`NormalizedEvent` shape) | `rules.test` |
| `audit_query` | read | `guild_id`, `tool?`, `actor_user_id?`, `limit? 1-200`, `before_id?` | `ctx.services.audit.query` |

Unscoped tools (`guildFrom` returns `null`) must be `read` tier. Add a check to `defineTool` in `src/tools/define.ts` (same owner) that throws at definition time when `guildFrom` is declared unscoped for a non-read tool; unscoped is declared by an explicit `unscoped: true` flag on the definition, and the flag test lives in `tests/unit/tools/define.test.ts`.

- [ ] **Step 1-3:** Failing tests then implementation for audit-log and meta tools; commit.
- [ ] **Step 4:** Failing registry-level test in `tests/unit/tools/index.test.ts`: `allTools` has unique names, at least 85 tools, every name matches the regex, every destructive tool has `preview`, every non-`null`-guild tool's schema has `guild_id`, unscoped tools are read tier.
- [ ] **Step 5:** Fix any gaps found; `pnpm check`; commit `feat(tools): audit log and meta tools with registry checks`.

---

# Part D: `safety`

Owner tree: `src/safety/`, `src/rules/`, `src/auth/`, `tests/unit/{safety,rules,auth}/`.

## Task S1: Permission-to-tier mapping and policy engine

**Depends on:** C2

**Files:**
- Create: `src/safety/permissions.ts`, `src/safety/policy.ts`
- Test: `tests/unit/safety/{permissions,policy}.test.ts`

**Interfaces:**
- Produces:
```ts
export const PERM: { ADMINISTRATOR: bigint; KICK_MEMBERS: bigint; BAN_MEMBERS: bigint; MANAGE_CHANNELS: bigint; MANAGE_GUILD: bigint; VIEW_AUDIT_LOG: bigint; MANAGE_MESSAGES: bigint; MANAGE_ROLES: bigint; MANAGE_WEBHOOKS: bigint; MANAGE_GUILD_EXPRESSIONS: bigint; MANAGE_EVENTS: bigint; MANAGE_THREADS: bigint; MODERATE_MEMBERS: bigint }
export const tierFromDiscordPermissions: (bits: bigint, group: string) => Tier
export class PolicyEngine implements PolicyView {
  constructor(config: Pick<Config, 'guilds' | 'tools'>)
  guildAllowed(guildId: string): boolean
  maxTier(guildId: string): Tier | null
  toolDenied(name: string): boolean
  effectiveTier(principal: Principal, guildId: string, group: string): Tier | null   // null => guild not allowed or user has no access
  canRead(principal: Principal, guildId: string): boolean
  effective(principal: Principal): EffectivePolicy
}
```
- Bit values: ADMINISTRATOR `1n<<3n`, KICK `1n<<1n`, BAN `1n<<2n`, MANAGE_CHANNELS `1n<<4n`, MANAGE_GUILD `1n<<5n`, VIEW_AUDIT_LOG `1n<<7n`, MANAGE_MESSAGES `1n<<13n`, MANAGE_ROLES `1n<<28n`, MANAGE_WEBHOOKS `1n<<29n`, MANAGE_GUILD_EXPRESSIONS `1n<<30n`, MANAGE_EVENTS `1n<<33n`, MANAGE_THREADS `1n<<34n`, MODERATE_MEMBERS `1n<<40n`.
- Group to destructive-capable permission: `guild` MANAGE_GUILD; `channels` MANAGE_CHANNELS; `threads` MANAGE_THREADS; `roles` and `members` MANAGE_ROLES; `moderation` BAN or KICK or MODERATE_MEMBERS; `messages` MANAGE_MESSAGES; `webhooks` MANAGE_WEBHOOKS; `scheduled_events` MANAGE_EVENTS; `invites` MANAGE_GUILD; `emojis` MANAGE_GUILD_EXPRESSIONS; `audit_log` VIEW_AUDIT_LOG (read-only group: caps at `read`); `meta` none.
- Rule (spec §8): ADMINISTRATOR -> `destructive`; else group permission present -> `destructive` (`read` for `audit_log`); else MANAGE_GUILD -> `write`; else any membership -> `read`.
- Effective tier: `stdio`/`service` principals -> `policy max_tier` of the guild; `user` principals -> `min(policy max_tier, tierFromDiscordPermissions(BigInt(principal.guilds[g]), group))`, and `null` if the user has no entry for that guild.

**Acceptance:** truth-table tests for every group and permission combination above; `effective` lists only allowlisted guilds the principal can see; `toolDenied` matches exact names.

- [ ] **Step 1: Failing tests** (excerpt; write the full table)

```ts
it('administrator is destructive everywhere', () => {
  for (const g of ['guild', 'moderation', 'meta']) expect(tierFromDiscordPermissions(PERM.ADMINISTRATOR, g)).toBe('destructive')
})
it('manage_guild alone is write, not destructive, for moderation', () => {
  expect(tierFromDiscordPermissions(PERM.MANAGE_GUILD, 'moderation')).toBe('write')
})
it('ban permission makes moderation destructive', () => {
  expect(tierFromDiscordPermissions(PERM.MANAGE_GUILD | PERM.BAN_MEMBERS, 'moderation')).toBe('destructive')
})
it('audit_log never exceeds read', () => {
  expect(tierFromDiscordPermissions(PERM.VIEW_AUDIT_LOG, 'audit_log')).toBe('read')
})
it('user effective tier is capped by policy', () => {
  const p = new PolicyEngine({ guilds: { [G]: { max_tier: 'write' } }, tools: { deny: [] } })
  const user = { kind: 'user' as const, userId: 'u', userName: 'u', guilds: { [G]: PERM.ADMINISTRATOR.toString() } }
  expect(p.effectiveTier(user, G, 'guild')).toBe('write')
})
```
- [ ] **Step 2:** Run, expect FAIL; implement; run, expect PASS; commit `feat(safety): permission tiers and policy engine`.

## Task S2: Confirm tokens and audit writer

**Depends on:** C2, C3

**Files:** Create `src/safety/{confirm,audit}.ts`; Test `tests/unit/safety/{confirm,audit}.test.ts`

**Interfaces:**
- Produces:
```ts
export const hashInput: (input: unknown) => string                    // sha256 hex of canonicalJson(input)
export const hashToken: (token: string) => string                     // sha256 hex
export interface ConfirmService {
  issue(tool: string, input: unknown, principal: Principal): { token: string; expiresAt: number }
  verify(tool: string, input: unknown, principal: Principal, token: string): 'ok' | 'invalid' | 'expired'   // consumes on ok
}
export const createConfirmService: (d: { store: Store; now?: () => number; ttlMs?: number }) => ConfirmService   // ttl default 300000; token = 32 random bytes base64url
export interface AuditWriter { write(e: NewAuditEntry): void }
export const createAuditWriter: (d: { store: Store; logger: Logger }) => AuditWriter                            // insert row and log line with correlation_id, user_name
export const createAuditPort: (d: { store: Store; policy: PolicyEngine }) => AuditPort                          // query limited to guilds the principal can read
```
`input` passed to `issue`/`verify` is the tool input **without** `confirm_token`.

**Acceptance:** replay returns `invalid`; different input, principal or tool returns `invalid`; after TTL returns `expired`; tokens are stored only as hashes; `AuditPort.query` for a principal without read on the guild throws `guild_not_allowed`; audit writer never logs raw input.

- [ ] **Step 1:** Failing tests (issue then verify ok; second verify invalid; mutated input invalid; other principal invalid; fake clock past 5 minutes expired; store row contains no plaintext token). **Step 2:** implement; **Step 3:** failing tests then audit writer and audit port; commit `feat(safety): confirm tokens and audit`.

## Task S3: `runTool` pipeline and bulk limiter

**Depends on:** S1, S2

**Files:** Create `src/safety/{limiter,pipeline}.ts`, `src/safety/index.ts`; Test `tests/unit/safety/{limiter,pipeline}.test.ts`

**Interfaces:**
- Produces:
```ts
export interface BulkLimiter { take(guildId: string): { ok: true } | { ok: false; retryAfterSec: number } }
export const createBulkLimiter: (d: { perMinute: number; now?: () => number }) => BulkLimiter     // token bucket per guild
export interface PipelineDeps { policy: PolicyEngine; confirm: ConfirmService; audit: AuditWriter; limiter: BulkLimiter; now?: () => number }
export interface RunOptions {
  discord: DiscordPort; services: Services; logger: Logger; correlationId: string
  elicit?: (message: string) => Promise<'accept' | 'decline' | 'unsupported'>
  preauthorized?: boolean        // rules only: skip confirm for destructive tools when rule allow_destructive and policy allow
}
export const runTool: (deps: PipelineDeps, def: AnyToolDef, rawInput: unknown, principal: Principal, opts: RunOptions) => Promise<ToolResult>
```
- Bulk tools (limited by the bucket): `messages_purge`, `roles_bulk_assign`, `mod_bulk_ban`, `guild_prune`.

**Pipeline (exact order, spec §8):**
1. Denied tool name -> audit `denied`, throw `McpToolError('tier_exceeded', 'tool disabled by policy')`.
2. Parse `rawInput` with `def.input` (zod) -> `invalid_input` with issue paths. Split off `confirm_token`.
3. `guildFrom(input)`; `null` is legal only for `read` tools. Otherwise: `!policy.guildAllowed` -> `guild_not_allowed`.
4. `effectiveTier(principal, guild, def.group)`; `null` -> `guild_not_allowed`; `rank(def.tier) > rank(effective)` -> `tier_exceeded` with `details: { required: def.tier, effective }`.
5. If bulk tool: `limiter.take(guild)`; not ok -> `rate_limited` with `retry_after`.
6. If `def.tier === 'destructive'` and not `preauthorized`:
   - `confirm_token` present -> `verify`; `invalid|expired` -> `confirm_invalid`; then run handler.
   - absent -> if `opts.elicit` available: run `preview`, ask `elicit(preview.summary)`; `accept` -> run handler; `decline` -> throw `McpToolError('confirm_invalid', 'declined by user')`; `unsupported` -> fall through to token flow.
   - token flow: run `preview`, `issue`, audit `dry_run`, throw `McpToolError('confirm_required', 'confirmation required', { preview, confirm_token, expires_in_sec: 300 })`.
7. Run handler inside try/catch: `McpToolError` propagates; other errors map to `internal` (message `internal error`, original logged at error level with `correlation_id`).
8. Audit row for every outcome (`ok | dry_run | denied | error`) with `latencyMs`, `inputHash = hashInput(input)`, actor and actor id from principal. Denials thrown before step 3 use `guildId: null`.

**Acceptance:** tests for every branch: denied tool, invalid input, guild not allowed, tier exceeded (user capped below tool tier), null-guild read tool ok and null-guild write tool rejected, rate limit, destructive without token returns `confirm_required` with preview and does NOT call handler, valid token executes handler exactly once and replay fails, elicitation accept/decline/unsupported, `preauthorized` skips confirmation, handler error mapped to `internal`, one audit row per call with the right outcome.

- [ ] **Step 1:** Failing limiter tests (burst up to `perMinute`, refill over time with fake clock, per-guild isolation, `retryAfterSec` >= 1). Implement; commit.
- [ ] **Step 2:** Failing pipeline tests, starting with the destructive flow:

```ts
it('destructive call without token returns preview and token, handler untouched', async () => {
  const handler = vi.fn(async () => ({ data: 'done' }))
  const def = destructiveTool({ handler, preview: async () => ({ summary: 's', affected: { channels: 1 } }) })
  await expect(runTool(deps, def, { guild_id: G, channel_id: C }, adminPrincipal, opts)).rejects.toMatchObject({
    code: 'confirm_required',
    details: { preview: { summary: 's' }, confirm_token: expect.any(String) },
  })
  expect(handler).not.toHaveBeenCalled()
})
it('token from a different input is rejected', async () => { /* issue for channel C, execute with channel D -> confirm_invalid */ })
```
- [ ] **Step 3:** Implement `pipeline.ts` in the order above; write `index.ts` exporting `PolicyEngine`, `createConfirmService`, `createAuditWriter`, `createAuditPort`, `createBulkLimiter`, `runTool`, `hashInput`, `tierFromDiscordPermissions`, `PERM`. `pnpm check`; commit `feat(safety): runTool pipeline with dry-run confirmation`.

## Task S4: Rules engine and service

**Depends on:** S3, D5 (types only: `subscribe`), C3

**Files:** Create `src/rules/{match,template,engine,service,index}.ts`; Test `tests/unit/rules/*.test.ts`

**Interfaces:**
- Produces:
```ts
export const eventMatches: (rule: Pick<Rule, 'trigger' | 'conditions'>, e: NormalizedEvent, now: number) => boolean
export const renderTemplate: (template: Record<string, unknown>, e: NormalizedEvent) => Record<string, unknown>   // "{{event.data.user_id}}" and "{{event.guild_id}}" placeholders; missing key throws Error('template: missing <path>')
export interface RulesService extends RulesPort { start(): void; stop(): void; disableForOwner(userId: string, reason: string): void }
export const createRulesService: (d: {
  store: Store; policy: PolicyEngine; pipeline: PipelineDeps
  subscribe: (cb: (e: NormalizedEvent) => void) => () => void
  toolByName: (name: string) => AnyToolDef | undefined
  discord: DiscordPort; services: () => Services; logger: Logger; now?: () => number
  newId?: () => string
}) => RulesService
```
- Trigger `filter` is an equality map on `event.data` keys (all must match). Conditions per `ConditionSchema`: `equals`, `matches` (anchored-safe `new RegExp` with length limit 200 and a 50 ms guard by running on inputs truncated to 2000 chars), `in`, `member_has_role` (`data.roles` includes), `account_age_lt_days` (from `data.account_created_at`), `message_contains` (case-insensitive on `data.content`; false if content absent).
- Principal for actions: the rule owner as `{ kind: 'user', userId: owner, ... }` with permissions re-read from the owner's live session guilds; rules created by stdio/service principals run as that principal kind with policy only.
- Creation checks: every action tool exists; input templates only reference `event.*`; `allow_destructive` false while any action tool is destructive is rejected at creation (`invalid_input`); owner must have effective `write` tier in the rule guild (`tier_exceeded` otherwise).
- Execution: for a matching event, respect `cooldown_sec` (`RuleRepo` cooldown), a per-guild action rate limit of 30 actions/minute, and the **loop guard**: actions run with `correlationId = "rule:<id>:<event.id>"`; events generated while an action of rule R is in flight for the same guild and targeting the same resource are tagged in an in-memory `recentActionKeys` set (keyed by `guildId:type:resourceId`, TTL 30 s) and ignored by rule R. Destructive actions run with `preauthorized: true` only when `rule.allow_destructive` and `policy.effectiveTier` allows.
- Fail closed: `disableForOwner` disables all of an owner's rules with `disabled_reason`; also, before running any rule the engine re-checks the owner's effective tier and disables the rule (audited via a `denied` audit entry) if it fell below the action tier.

**Acceptance:** unit tests for each condition; template rendering including missing key; cooldown; loop guard (rule action creating a channel does not retrigger its own `channel_create` rule but does trigger other rules); creation validation failures; fail-closed after demotion; `rules_test` returns matched flag and rendered action inputs with outcome `would_run` without calling any handler; destructive action with `allow_destructive: false` never executes.

- [ ] **Step 1-2:** Failing tests then `match.ts` and `template.ts`; commit.
- [ ] **Step 3-4:** Failing tests then `engine.ts` (cooldown, loop guard, action execution through `runTool`, fail closed); commit.
- [ ] **Step 5:** Failing tests then `service.ts` (`RulesPort` CRUD with ownership checks: a principal may modify only rules they own or, for stdio/service, any rule in an allowed guild) and `test()`; `pnpm check`; commit `feat(rules): automation rules engine`.

## Task S5: OAuth authorization server (Discord as IdP)

**Depends on:** C3, D1 (`DiscordOAuthPort` contract only)

**Files:** Create `src/auth/{clients-store,tokens,provider,router,index}.ts`; Test `tests/unit/auth/{clients-store,tokens,provider}.test.ts`

**Interfaces:**
- Produces:
```ts
export const newToken: () => string                       // 32 random bytes base64url
export const hashSecret: (s: string) => string            // sha256 hex
export const createClientsStore: (store: Store) => OAuthRegisteredClientsStore   // SDK type from @modelcontextprotocol/sdk/server/auth/clients.js
export const createAuthProvider: (d: {
  store: Store; discordOAuth: DiscordOAuthPort; discord: Pick<DiscordPort, 'listBotGuildIds'>
  policy: Pick<PolicyEngine, 'guildAllowed'>
  config: { publicBaseUrl: string; discordClientId: string }
  now?: () => number
}) => OAuthServerProvider & { handleDiscordCallback(req: { code: string; state: string }): Promise<{ redirectTo: string }> }
export const createAuthRouter: (provider, d: { publicBaseUrl: string }) => express.Router   // mcpAuthRouter + GET /callback
```
- Flow: `authorize(client, params, res)` validates client redirect URI (exact match) and PKCE presence, saves a `PendingAuth` (state = `newToken()`, TTL 10 min), redirects to `https://discord.com/oauth2/authorize?response_type=code&client_id=...&scope=identify+guilds&redirect_uri=<publicBaseUrl>/callback&state=...`. `handleDiscordCallback`: consume pending (single use), exchange code, fetch user and guilds, keep guilds where permissions include ADMINISTRATOR or MANAGE_GUILD **and** the guild is in `listBotGuildIds()` **and** `policy.guildAllowed`; if none, redirect to the client with `error=access_denied`; otherwise store an `AuthCode` (TTL 5 min, hashed) with the guild map and redirect to the client's redirect URI with `code` and the client's original `state`. `challengeForAuthorizationCode`, `exchangeAuthorizationCode` (single use; mints access token 1 h and refresh token 30 days, stored hashed as a new session family), `exchangeRefreshToken` (rotation via `rotateRefresh`; on reuse revoke family and throw `invalid_grant`), `verifyAccessToken` (see S6), `revokeToken`.
- The SDK's `mcpAuthRouter` provides `/authorize`, `/token`, `/register`, `/revoke` and the two `.well-known` documents. **First step of this task: read the installed SDK's `server/auth` typings and confirm the provider interface names above; adapt the adapter code to the installed version. If the installed SDK lacks the router, implement the same endpoints by hand behind the same `express.Router` interface.**

**Acceptance:** tests (unit level, no network, fake Discord OAuth port) cover: client registration stores exact redirect URIs; `authorize` rejects unregistered redirect URI and missing PKCE; callback with unknown/replayed/expired state fails; non-admin user gets `access_denied`; admin of a guild the bot is not in or policy doesn't allow gets `access_denied`; code exchange succeeds once, replay fails; PKCE mismatch fails; refresh rotation issues new tokens; refresh reuse revokes the whole family; revoked token no longer verifies; no secret or token appears in any thrown error message.

- [ ] **Step 1:** Read SDK auth typings; write a short adapter note at the top of `provider.ts` comments-free (types speak); failing tests for `createClientsStore`; implement; commit.
- [ ] **Step 2:** Failing tests then `authorize` + `handleDiscordCallback`; commit.
- [ ] **Step 3:** Failing tests then code exchange, PKCE challenge lookup; commit.
- [ ] **Step 4:** Failing tests then refresh rotation, reuse detection, revocation; commit.
- [ ] **Step 5:** `router.ts` composing `mcpAuthRouter` and `/callback`; failing route tests using `express` on port 0 with `fetch` (metadata documents present and issuer equals `publicBaseUrl`; `/callback` with bad state returns 400). `pnpm check`; commit `feat(auth): oauth authorization server with discord login`.

## Task S6: Bearer validation, principals, permission refresh

**Depends on:** S1, S5

**Files:** Create `src/auth/{bearer,principal,refresh}.ts`; Modify `src/auth/index.ts`; Test `tests/unit/auth/{bearer,principal,refresh}.test.ts`

**Interfaces:**
- Produces:
```ts
export const createBearerMiddleware: (d: {
  store: Store; serviceTokens: Config['http']['service_tokens']; publicBaseUrl: string; now?: () => number
}) => express.RequestHandler        // sets req.principal; 401 with WWW-Authenticate: Bearer resource_metadata="<publicBaseUrl>/.well-known/oauth-protected-resource"
export const principalFromSession: (s: Session) => Principal            // kind 'user', guilds from session
export const principalFromServiceToken: (name: string) => Principal      // kind 'service', userName = token name
export const createPermissionRefresher: (d: {
  store: Store; discord: Pick<DiscordPort, 'fetchMemberPermissions'>
  subscribe: (cb: (e: NormalizedEvent) => void) => () => void
  onDemoted: (userId: string, reason: string) => void      // wired to RulesService.disableForOwner
}) => { start(): void; stop(): void; refreshUser(userId: string): Promise<void> }
```
- Bearer: hashes the presented token; matches active (not revoked, not expired) session first, otherwise constant-time compares against service token hashes (`crypto.timingSafeEqual`). Missing/invalid/expired -> 401 with the header above and JSON `{ error: 'unauthorized' }`. Never logs the token.
- Refresher: on `member_*` or `role_*` events for guilds where a session user is present, calls `refreshUser`: re-reads `fetchMemberPermissions` for every guild in the user's sessions, updates session guild maps, drops guilds where the user lost ADMINISTRATOR and MANAGE_GUILD, and calls `onDemoted` when a guild is dropped. Also runs on refresh-token exchange (S5 exposes a hook parameter `beforeIssue?: (session) => Promise<Session>`; wire it here).

**Acceptance:** valid, expired, revoked and unknown tokens; service token accepted with constant-time compare (test uses equal-length wrong token); WWW-Authenticate header value exact; demotion drops the guild and calls `onDemoted`; unrelated events do nothing.

- [ ] **Step 1-2:** Failing tests then bearer + principal builders; commit. **Step 3-4:** Failing tests then refresher; `pnpm check`; commit `feat(auth): bearer middleware, principals and permission refresh`.

---

# Part E: `qa`

Owner tree: `tests/fakes/`, `tests/integration/`, `tests/e2e/`, `tests/contract/`. QA also performs the final whole-branch review. QA never edits `src/`; defects are reported to the owning teammate by message with a failing test path.

## Task Q1: Fakes (FakeDiscordPort, mock Discord server, harness)

**Depends on:** C2

**Files:** Create `tests/fakes/{fake-discord-port,fake-gateway,mock-discord-server,harness}.ts`, `tests/unit/fakes/fakes.test.ts`

**Interfaces:**
- Produces:
```ts
export class FakeDiscordPort implements DiscordPort {
  guilds: Map<string, Dto>; channels: Map<string, Dto>; roles: Map<string, Dto[]>; members: Map<string, Map<string, Dto>>
  messages: Map<string, Dto[]>; bans: Map<string, Set<string>>; webhooks: Map<string, Dto>
  calls: { method: string; args: unknown[] }[]
  seedGuild(id: string, opts?: { channels?: number; roles?: number; members?: number }): void
}
export class FakeGateway implements GatewayPort { emit(e: NewEvent): void; setStatus(s: GatewayStatus): void }
export const startMockDiscord: (o?: { users?: Record<string, { id: string; username: string; guilds: { id: string; permissions: string }[] }> }) => Promise<{ url: string; close(): Promise<void> }>   // implements /oauth2/token, /users/@me, /users/@me/guilds
export const buildHarness: (o: { config?: Partial<Config> }) => Promise<Harness>
interface Harness { client: Client; server: McpServer; discord: FakeDiscordPort; gateway: FakeGateway; store: Store; services: Services; close(): Promise<void>; asPrincipal(p: Principal): Client }
```
`FakeDiscordPort` implements every `DiscordPort` method in memory with Discord-like semantics (404 as `McpToolError('not_found')`, id generation as 18-digit snowflakes, cross-guild lookups by id return the right `guild_id` so the guild-binding checks are testable). `buildHarness` assembles the real registry, pipeline, events, rules and auth services using `src/server/wiring.ts` exports with the fakes injected. Because this depends on C5, the first version builds against `createMcpServer` from C5; until C5 merges, keep a local adapter and mark those tests `describe.skip` with a tracking note in the task list, then unskip.

**Acceptance:** fake behaviors have their own tests (create then list, delete then get is `not_found`, cross-guild channel lookup returns the other guild's id, bulk delete removes messages); mock OAuth server rejects unknown codes and returns configured users.

- [ ] **Step 1-3:** Failing tests then `FakeDiscordPort` (write in groups: guild/channels, roles/members/moderation, messages/misc); **Step 4:** `FakeGateway` and `mock-discord-server.ts`; **Step 5:** harness; `pnpm check`; commit `test: fakes and harness`.

## Task Q2: Registry-driven contract tests

**Depends on:** T1..T6 merged (all groups populated), C5 registry

**Files:** Create `tests/contract/tools.contract.test.ts`

**Acceptance:** generated from `allTools` and the built registry; each assertion runs per tool with a readable failure naming the tool:
- name regex and uniqueness; name starts with `<group>_` (or group-specific prefix table: `forum_` for threads group, `automod_`/`mod_` for moderation, `reactions_` for messages, `sevents_` for scheduled_events, `stickers_` for emojis, `server_`/`events_`/`rules_`/`audit_query` for meta);
- description non-empty and contains its tier word (`read`, `write` or `destructive`);
- input is a zod object; `guild_id` present unless unscoped; unscoped tools are read tier;
- destructive tools have `preview`, and in the built registry accept `confirm_token`; non-destructive do not;
- total tools >= 85;
- caps present: attempt to parse `messages_purge` with limit 1001, `roles_bulk_assign` and `mod_bulk_ban` with 201 ids -> validation failure;
- snapshot of the sorted list of `name:tier` pairs in `tests/contract/__snapshots__`, so tier changes are reviewed deliberately.

- [ ] **Step 1:** Write the test (fails if any tool violates a rule); run; report violations to `tools` by message; **Step 2:** once green, `pnpm check`; commit `test: tool contract tests`.

## Task Q3: Integration: policy matrix and confirm lifecycle over MCP

**Depends on:** S3, Q1, C5

**Files:** Create `tests/integration/{policy-matrix,confirm-lifecycle,guild-binding,errors}.test.ts`

**Acceptance (all via `harness.client.callTool`, real registry and pipeline):**
- Policy matrix: for principals {stdio, service, user admin, user with only MANAGE_GUILD, user with BAN_MEMBERS+MANAGE_GUILD, user not in guild} x guilds {`destructive`-capped, `write`-capped, not allowlisted} x tools {a read, a write, a destructive tool}: assert allowed/denied with the exact error code (`guild_not_allowed` or `tier_exceeded`), table-driven.
- Confirm lifecycle: destructive call returns `confirm_required` with preview and token and leaves Discord untouched (assert `discord.calls` has no mutating method); re-call with token executes once; replay `confirm_invalid`; token with changed input `confirm_invalid`; token from another principal `confirm_invalid`; expired token (fake clock) `confirm_invalid`.
- Guild binding: with two guilds A (allowed) and B (not allowed) seeded in the fake, `messages_send` with `guild_id=A` and `channel_id` of a B channel returns `not_found`, and the fake shows no send call; same for `channels_delete`, `webhooks_execute`, `invites_delete`.
- Errors: Discord `not_found` maps to MCP `isError` with code; unexpected exception maps to `internal` with no stack in content.
- Audit: each call above leaves exactly one audit row with the right `outcome`.
- Bulk caps and rate limit: 6th bulk call in a minute returns `rate_limited`.

- [ ] **Step 1:** Write tests (fail if wiring wrong); **Step 2:** report defects to owners; **Step 3:** green; `pnpm check`; commit `test: policy, confirm lifecycle, guild binding integration`.

## Task Q4: E2E: OAuth login flow

**Depends on:** S5, S6, Q1, C5

**Files:** Create `tests/e2e/oauth-flow.test.ts`

**Acceptance:** starts the real HTTP server (port 0) with `startMockDiscord`, runs the full flow with `fetch` (manual redirect handling):
- discovery: `/.well-known/oauth-protected-resource` and authorization-server metadata; unauthenticated `POST /mcp` -> 401 with `WWW-Authenticate` containing `resource_metadata`;
- register client -> `/authorize` with PKCE S256 -> redirect to mock Discord authorize URL parameters (`scope=identify guilds`, correct `state`) -> callback with mock code -> redirect to client with `code` and original client `state` -> `/token` -> use access token on `/mcp` (`initialize`, `tools/list`, `server_whoami` shows the user) -> refresh -> old refresh token replay revokes the family (new access token stops working) -> `/revoke`;
- negative cases: wrong redirect URI at `/authorize`, missing or wrong PKCE verifier at `/token`, replayed authorization code, replayed/forged `state`, non-admin user gets `access_denied` redirect, admin of a non-allowlisted guild gets `access_denied`, user admin of guild A only cannot call tools on guild B (`guild_not_allowed`), demotion via gateway `role_update` event removes the guild from the user's next call;
- no response body or server log line contains any issued token or the client secret (capture pino output and grep).

- [ ] **Step 1:** Write the flow helper and tests; **Step 2:** report defects; **Step 3:** green; commit `test: oauth end-to-end flow`.

## Task Q5: Events and rules integration, coverage gate, final review

**Depends on:** D5, S4, Q1, C5 and every other task

**Files:** Create `tests/integration/{events,rules}.test.ts`, `docs/review-2026-09-29.md` (review report)

**Acceptance:**
- Events: ordering; `events_poll` filters by type and `since_id`; pruning via small `max_buffer`; gap marker appears after `setStatus('disconnected')` then `'ready'`; a user principal without read on the guild gets `guild_not_allowed`; resource subscription delivers `notifications/resources/updated` for a new event.
- Rules through the MCP surface: `rules_create` then gateway `member_join` event executes a `roles_assign` action (assert `discord.calls`); cooldown suppresses second trigger; loop guard: rule on `channel_create` that creates a channel triggers once; destructive action with `allow_destructive: false` rejected at creation; owner demoted via refresher -> rule disabled and audited; `rules_test` performs no Discord calls.
- Coverage: `pnpm test:cov` passes the 85% line gate; list any module under 85% in the report with the owner.
- **Final whole-branch review** against the spec: for each spec section (§4 boundaries, §5 contracts, §6 discord, §7 tools, §8 safety, §9 events, §10 rules, §11 auth, §12 store, §13 server/CLI/docs, §14 testing, §16 ownership) write pass/fail with file references in `docs/review-2026-09-29.md`; check specifically: no `discord.js` import outside `src/discord`, no token in logs, every destructive tool previews without mutation, every channel/webhook/invite-scoped tool binds to `guild_id`, service-token comparison is constant-time, PKCE and state single-use, docs mention every env var. Send each defect to its owner; re-run after fixes.

- [ ] **Step 1-2:** Write events and rules integration tests; **Step 3:** coverage run and gap report; **Step 4:** whole-branch review report; **Step 5:** confirm all defects closed, `pnpm check` green; commit `test: events and rules integration; final review report`.

---

# Agent Team Execution

**Lead (orchestrator)** creates the team after plan approval and does not implement tasks. Teammates (short fixed names): `core`, `discord`, `tools`, `safety`, `qa`.

| Teammate | Owns (only these) | Tasks |
|---|---|---|
| `core` | `package.json`, configs, `.github/`, `README.md`, `config.example.yaml`, `src/contracts/`, `src/store/`, `src/cli/`, `src/server/`, `docs/getting-started.md`, `docs/smoke-checklist.md`, `tests/unit/{contracts,store,cli,server,docs}/`, `tests/unit/lint-boundaries.test.ts` | C1-C6 |
| `discord` | `src/discord/`, `src/events/`, `tests/unit/{discord,events}/` | D1-D5 |
| `tools` | `src/tools/`, `tests/unit/tools/` | T1-T6 |
| `safety` | `src/safety/`, `src/rules/`, `src/auth/`, `tests/unit/{safety,rules,auth}/` | S1-S6 |
| `qa` | `tests/fakes/`, `tests/integration/`, `tests/e2e/`, `tests/contract/`, `tests/unit/fakes/`, `docs/review-*.md` | Q1-Q5, final review |

**Task dependencies (declare in the task list):**

| Task | Blocked by |
|---|---|
| C1 | none |
| C2 | C1 |
| C3 | C2 |
| C4 | C2, C3 |
| C5 | C4, S3, T1, D1, D4, D5, S4, S5, S6 (scaffold and unit-test against fakes early; final wiring last) |
| C6 | C5 |
| D1 | C2 |
| D2 | D1 |
| D3 | D2 |
| D4 | D1 |
| D5 | C3 |
| T1 | C2 |
| T2, T3, T4, T5 | T1 |
| T6 | T1 |
| S1 | C2 |
| S2 | C2, C3 |
| S3 | S1, S2 |
| S4 | S3, C3 |
| S5 | C3, C2 |
| S6 | S1, S5 |
| Q1 | C2 |
| Q2 | T1-T6, C5 |
| Q3 | S3, Q1, C5 |
| Q4 | S5, S6, Q1, C5 |
| Q5 | D5, S4, Q1, C5, and all others |

Task counts: core 6, discord 5, tools 6, safety 6, qa 5.

**Spawn prompt template (each teammate gets its own filled copy; teammates do not see this conversation):**

```
You are "<name>" on the discord-mcp agent team. Repo: /Users/phucth/vibes/discord-mcp (TypeScript, pnpm).
Read first: docs/superpowers/specs/2026-09-29-discord-mcp-design.md and docs/superpowers/plans/2026-09-29-discord-mcp.md (your tasks: <ids>; the "Global Constraints" section applies to every task).
You OWN only: <paths>. Never edit files outside them. If you need a change elsewhere, message the owner
(core: contracts/store/cli/server/tooling; discord; tools; safety; qa) with the exact change and why.
Conventions (from the user's CLAUDE.md): no inline comments on self-documenting code; no zero-arg factory functions
(use `const x: T = value`); logs use underscore field names (correlation_id, request_id, trace_id, span_id, method, path,
status, ip, latency, user_name, ja4); keep responses terse. Commits are Conventional Commits ending with
"Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>". Commit only your own files, small and often, on the shared branch;
run `git pull --rebase` (or check `git status`) before committing if the tree changed.
Method: use Superpowers (test-driven-development, verification-before-completion). Write the failing test first.
Definition of done for a task: its tests pass AND `pnpm typecheck && pnpm lint && pnpm test && pnpm build` are clean.
Mark a task completed only then; never on a failing build. If blocked, mark it blocked with the reason and message the lead.
Acceptance criteria for your tasks are in the plan under each task. Tasks and their blockers: <table rows>.
When a task you own unblocks others, message the dependent owners.
```

**Lead protocol:**
1. Create the shared task list with the 28 tasks and the dependency table above; spawn the five teammates with filled prompts (`core` starts C1; others begin with any task whose blockers are met, reading the plan while C1/C2 land).
2. Wait for teammates; do not implement tasks; relay cross-owner change requests only when a teammate asks.
3. Do not stop until every task is completed or explicitly blocked (blocked tasks get an owner reply and a decision from the user).
4. When all tasks are done, run `pnpm typecheck && pnpm lint && pnpm test:cov && pnpm build`. Then read `docs/review-2026-09-29.md` from `qa`, verify each item is closed, and do a last spot check against the spec.
5. Invoke `superpowers:finishing-a-development-branch` (lead only) and present merge / PR / keep / discard options.

**Working tree note:** all teammates commit to one branch (`feat/discord-mcp`, created by the lead before spawning) in one working tree; ownership boundaries keep files disjoint. If the user prefers isolation, spawn each teammate with a worktree and have the lead merge; the plan does not change.

---

# Self-review (against the spec)

| Spec section | Covered by |
|---|---|
| §3 stack, §4 layout and boundaries | C1 |
| §5 contracts | C2 |
| §6 discord layer | D1-D4 |
| §7 tools (12 groups, caps, previews) | T1-T6, Q2 |
| §8 safety pipeline, config | S1-S3, C2 (`ConfigSchema`), C4 |
| §9 events | D4, D5, C5 (resource), T6 (`events_poll`), Q5 |
| §10 rules | S4, T6, Q5 |
| §11 auth | S5, S6, Q4 |
| §12 store | C3 |
| §13 server, CLI, `invite-url`, getting started | C4, C5, C6 |
| §14 testing | every task plus Q1-Q5 |
| §16 ownership | Agent Team Execution |

Decision changes vs. the spec, both applied to the spec in the same commit: (1) every tool takes `guild_id` and channel/webhook/invite-scoped tools verify the resource belongs to it (prevents acting on non-allowlisted guilds); (2) `GatewayPort` added to contracts so `events` stays free of `discord.js`.
