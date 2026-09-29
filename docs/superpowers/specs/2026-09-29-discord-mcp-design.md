# discord-mcp — Design Spec

Date: 2026-09-29
Status: Draft for approval

## 1. Purpose

An MCP server that lets an LLM client manage Discord guilds: structure, members, moderation, messages, webhooks, scheduled events, plus live event streaming and an automation rules engine. Access is governed by a tiered safety policy and, over HTTP, by Discord-backed OAuth2 login of guild admins.

This repository is also a test bed for an agent team, so the design favors hard module boundaries and typed contracts that let several teammates work in parallel.

## 2. Non-goals

- Voice/audio streaming or playing audio.
- Slash-command or interaction hosting (this is a management server, not a bot framework).
- Multi-tenant hosting of many bot tokens (one bot token per deployment).
- A web UI.
- Postgres or any storage other than SQLite.

## 3. Stack

- Node 22, TypeScript (strict), ESM.
- `@modelcontextprotocol/sdk`, `discord.js`, `better-sqlite3`, `zod`, `pino`, `yaml`, `hono` (HTTP server for MCP + OAuth endpoints).
- pnpm, vitest, eslint (typescript-eslint + import-boundary rules), tsup for build.
- Package name `discord-mcp`, single package (modular monolith).

## 4. Architecture

```
src/
  contracts/   shared types and zod schemas (single source of truth)
  discord/     DiscordPort implementation over discord.js
  events/      gateway -> normalized events, buffer, MCP resources
  safety/      policy, tiers, dry-run, confirm tokens, audit
  rules/       automation engine
  auth/        OAuth2 authorization server (Discord as IdP), bearer validation
  store/       SQLite, migrations, repositories
  tools/       tool groups, one file per group
  server/      MCP server assembly, transports, config wiring
  cli/         entrypoint, `--check`
tests/
  unit/        mirrors src/
  integration/ in-memory MCP client + fake DiscordPort
  e2e/         auth flow against mock Discord OAuth server
  contract/    registry-driven tool contract tests
  fakes/       FakeDiscordPort, mock Discord OAuth/REST server
docs/
```

### 4.1 Boundary rules (enforced by eslint `no-restricted-imports`)

| Module | May import |
|---|---|
| `contracts` | nothing internal |
| `tools` | `contracts` only |
| `rules` | `contracts`, `safety` (pipeline entry only) |
| `events` | `contracts`, `store` |
| `safety` | `contracts`, `store` |
| `auth` | `contracts`, `store` |
| `discord` | `contracts` |
| `store` | `contracts` |
| `server`, `cli` | everything |

`discord.js` may be imported only inside `src/discord/`.

## 5. Contracts (`src/contracts/`)

Written and merged first. All other modules code against these.

```ts
type Tier = 'read' | 'write' | 'destructive'

interface ToolDef<I extends z.ZodTypeAny = z.ZodTypeAny> {
  name: string                         // snake_case, unique, prefixed by group
  group: string
  description: string
  tier: Tier
  input: I                             // zod schema
  guildFrom: (input: z.infer<I>) => string | null   // how to resolve target guild
  preview?: (ctx: ToolContext, input: z.infer<I>) => Promise<PreviewResult> // required if tier==='destructive'
  handler: (ctx: ToolContext, input: z.infer<I>) => Promise<ToolResult>
}

interface ToolContext { discord: DiscordPort; principal: Principal; correlationId: string; logger: Logger }

interface Principal {
  kind: 'stdio' | 'service' | 'user'
  userId: string | null
  userName: string
  guilds: Record<string, bigint>      // guildId -> Discord permission bits (user kind); stdio/service: policy only
}

interface DiscordPort { /* typed methods per Discord operation used by tools; see 6 */ }

interface NormalizedEvent { id: number; guildId: string; type: EventType; at: string; data: unknown }
interface Rule { id: string; guildId: string; ownerUserId: string | null; trigger: { event: EventType; filter: Record<string, unknown> }; conditions: Condition[]; actions: ActionSpec[]; cooldownSec: number; allowDestructive: boolean; enabled: boolean }
interface AuditEntry { id: number; at: string; correlationId: string; tool: string; tier: Tier; guildId: string | null; actor: string; actorUserId: string | null; inputHash: string; outcome: 'ok' | 'dry_run' | 'denied' | 'error'; errorCode: string | null; latencyMs: number }
```

Error codes (typed, never raw stack traces): `guild_not_allowed`, `tier_exceeded`, `missing_permissions`, `not_found`, `rate_limited` (with `retry_after`), `invalid_input`, `confirm_required`, `confirm_invalid`, `unauthorized`, `internal`.

## 6. Discord layer (`src/discord/`)

`DiscordPort` implementation wrapping discord.js REST and gateway client.

- REST only for tool operations; gateway used for events and cache-free reads.
- Maps discord.js errors to contract error codes.
- Exposes `onGatewayEvent(cb)` consumed by `events/`.
- Provides `fetchUserGuilds(userAccessToken)` and `fetchMemberPermissions(guildId, userId)` for `auth/`.
- Bot token from `DISCORD_BOT_TOKEN`, never logged.
- Required intents configured in one place: Guilds, GuildMembers, GuildModeration, GuildMessages, MessageContent (optional, config flag), GuildVoiceStates, GuildScheduledEvents.

## 7. Tools (`src/tools/`)

About 90 tools across 12 groups. Names are `<group>_<verb>_<noun>`. Tiers: R = read, W = write, D = destructive.

| Group | Tools |
|---|---|
| guild | `guild_get` R, `guild_list` R, `guild_update` W, `guild_get_preview` R, `guild_get_prune_count` R, `guild_prune` D, `guild_get_widget` R, `guild_update_widget` W |
| channels | `channels_list` R, `channels_get` R, `channels_create` W, `channels_update` W, `channels_move` W, `channels_set_permissions` W, `channels_delete_permissions` W, `channels_delete` D, `channels_clone` W |
| threads | `threads_list_active` R, `threads_list_archived` R, `threads_create` W, `threads_update` W, `threads_add_member` W, `threads_remove_member` W, `threads_delete` D, `forum_create_post` W, `forum_list_tags` R, `forum_update_tags` W |
| roles | `roles_list` R, `roles_get` R, `roles_create` W, `roles_update` W, `roles_reorder` W, `roles_assign` W, `roles_remove` W, `roles_bulk_assign` D, `roles_delete` D |
| members | `members_list` R, `members_get` R, `members_search` R, `members_update_nick` W, `members_add_role` W, `members_remove_role` W, `members_move_voice` W, `members_disconnect_voice` W |
| moderation | `mod_timeout` W, `mod_remove_timeout` W, `mod_kick` D, `mod_ban` D, `mod_unban` W, `mod_bulk_ban` D, `mod_list_bans` R, `automod_list_rules` R, `automod_create_rule` W, `automod_update_rule` W, `automod_delete_rule` D |
| messages | `messages_list` R, `messages_get` R, `messages_send` W, `messages_edit` W, `messages_delete` D, `messages_purge` D, `messages_pin` W, `messages_unpin` W, `messages_list_pins` R, `messages_crosspost` W, `reactions_add` W, `reactions_remove` W, `reactions_clear` D, `messages_search` R |
| webhooks | `webhooks_list` R, `webhooks_create` W, `webhooks_update` W, `webhooks_execute` W, `webhooks_delete` D |
| scheduled_events | `sevents_list` R, `sevents_get` R, `sevents_create` W, `sevents_update` W, `sevents_list_users` R, `sevents_delete` D |
| invites | `invites_list` R, `invites_create` W, `invites_delete` D |
| emojis | `emojis_list` R, `emojis_create` W, `emojis_update` W, `emojis_delete` D, `stickers_list` R, `stickers_create` W, `stickers_delete` D |
| audit_log | `audit_log_list` R, `audit_log_by_user` R, `audit_log_by_action` R |
| meta | `server_whoami` R, `server_policy` R (effective policy for principal), `events_poll` R, `rules_create` W, `rules_list` R, `rules_update` W, `rules_delete` W, `rules_test` R, `audit_query` R |

Rules for every tool:
- Description states target, effect, and tier.
- Destructive tools implement `preview` returning a human-readable diff/summary and affected counts.
- `messages_purge` capped at 1000 messages per call; `roles_bulk_assign`, `mod_bulk_ban` capped at 200 targets per call.
- Handlers use only `ctx.discord`; never `discord.js`.

The exact list is a starting inventory. The implementation plan finalizes it, and the contract test asserts that every registered tool meets the rules above.

## 8. Safety (`src/safety/`)

Every tool invocation, including rule actions, passes one pipeline `runTool(def, input, principal)`:

1. Validate input with the tool's zod schema (`invalid_input`).
2. Resolve guild via `guildFrom`. Reject if not in the policy allowlist (`guild_not_allowed`).
3. Compute effective tier = `min(policy.guilds[g].max_tier, tierFromDiscordPermissions(principal.guilds[g]))`. For stdio and service principals only the policy applies. Reject if `def.tier` exceeds it (`tier_exceeded`). Tool names in `tools.deny` are rejected.
4. Apply per-guild token-bucket rate limit for bulk tools.
5. If `def.tier === 'destructive'`:
   - No `confirm_token` in input (or elicitation declined): run `preview`, mint a single-use token bound to `sha256(canonical(input))` and principal, TTL 5 minutes, return `confirm_required` with preview and token.
   - Token present: verify binding, expiry, and single use (`confirm_invalid` otherwise), consume, run handler.
   - If the client supports MCP elicitation, ask for confirmation in-band instead of returning a token.
6. Write an audit row for every outcome.

`tierFromDiscordPermissions` is a table: `ADMINISTRATOR` → destructive; `MANAGE_GUILD`, `BAN_MEMBERS`, `KICK_MEMBERS`, `MANAGE_CHANNELS`, `MANAGE_ROLES`, `MANAGE_MESSAGES` → destructive only for tools in the matching group, otherwise write; any other membership → read.

### 8.1 Config (YAML, path via `--config` or `DISCORD_MCP_CONFIG`)

```yaml
guilds:
  "123456789012345678": { max_tier: destructive }
  "223456789012345678": { max_tier: write }
tools: { deny: [guild_prune] }
rate_limits: { bulk_per_minute: 5 }
events: { retention_hours: 72, max_buffer: 50000 }
http: { host: 0.0.0.0, port: 8787, service_tokens: [{ name: ci, sha256: "..." }] }
```

Validated by a zod schema; `discord-mcp --check` validates config and connectivity.

## 9. Events (`src/events/`)

- Normalizes gateway events: `message_create`, `message_update`, `message_delete`, `member_join`, `member_remove`, `member_ban`, `member_unban`, `role_create`, `role_update`, `role_delete`, `channel_create`, `channel_update`, `channel_delete`, `voice_state`, `scheduled_event`. Message content is included only if the MessageContent intent is enabled by config.
- Each event gets a monotonic id and is stored in the SQLite buffer, pruned by retention and max size.
- MCP surface:
  - Resource template `discord://guild/{guild_id}/events` with subscription; notification emitted on new events.
  - Tool `events_poll(guild_id, since_id, types?, limit)` for clients without subscriptions.
- Events are delivered only for guilds the principal may read (policy and Discord permissions).
- Gateway disconnect and resume are handled; gaps are recorded as a `gap` marker event.

## 10. Rules engine (`src/rules/`)

- Rule = trigger (event type + filter) → conditions → actions. Actions are `{tool, input_template}`; templates reference event fields.
- Conditions: field equals/matches/in, member has role, account age, message contains (when content available).
- Actions execute through the same `runTool` pipeline, with the rule owner as principal. Destructive actions require `allow_destructive: true`, and the rule may not confirm on its own: it uses a pre-authorized confirmation only if both the rule flag and policy allow it.
- Per-rule cooldown, global per-guild action rate limit, and a loop guard: events caused by actions of a rule (tracked by correlation id) never re-trigger that rule.
- Fail closed: if the owner's admin status is lost (permission refresh) or the guild policy tightens, the rule is disabled and audited.
- `rules_test` runs a rule against a supplied sample event in dry-run mode.

## 11. Auth (`src/auth/`), HTTP transport only

stdio: no login; the config policy governs (principal kind `stdio`).

HTTP `/mcp` is an OAuth 2.1 protected resource following the MCP authorization spec. The server is its own authorization server with Discord as identity provider.

Endpoints:
- `GET /.well-known/oauth-protected-resource`, `GET /.well-known/oauth-authorization-server`
- `POST /register` dynamic client registration; redirect URIs stored and matched exactly.
- `GET /authorize` requires PKCE S256, stores a single-use `state`, redirects to Discord OAuth2 (`identify guilds` scopes).
- `GET /callback` exchanges the Discord code, fetches the user's guilds, keeps guilds where the user has `ADMINISTRATOR` or `MANAGE_GUILD` and the bot is present and the guild is in the policy allowlist, then issues an authorization code to the client.
- `POST /token` grants `authorization_code` (verify PKCE) and `refresh_token` (rotating; reuse of a rotated token revokes the family).
- `POST /revoke`.
- Bearer middleware: missing or invalid token gives 401 with `WWW-Authenticate: Bearer resource_metadata=...`.

Tokens: access token 1 hour, refresh token 30 days, both opaque and stored hashed in SQLite. The `Principal` is rebuilt from the session on each request. Guild permissions are re-fetched on refresh and when a gateway role or member update touches that user.

Service tokens (`http.service_tokens`) give a `service` principal governed only by policy.

Secrets from environment: `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUBLIC_BASE_URL`, `TOKEN_SIGNING_KEY`.

Security requirements: exact redirect URI match, PKCE required, state single use and 10 minute TTL, constant-time token comparison, no secrets or tokens in logs, CORS restricted to registered redirect origins, request body size limits.

## 12. Store (`src/store/`)

SQLite via better-sqlite3, WAL mode, versioned migrations applied on start. Tables: `audit`, `confirmations`, `events`, `rules`, `oauth_clients`, `oauth_codes`, `oauth_sessions`, `oauth_states`, `meta`. Repositories expose typed functions; no SQL outside `store/`.

## 13. Server (`src/server/`) and CLI (`src/cli/`)

- Assembles registry of all `ToolDef`s, wires `runTool`, registers MCP tools and resources.
- Transports: stdio (default) and streamable HTTP (`--http`).
- `GET /healthz` reports gateway and DB status.
- `discord-mcp invite-url [--permissions <preset|bits>]` prints the bot invite URL from `DISCORD_CLIENT_ID` (scope `bot` only). Presets: `read`, `moderator`, `manager`, `admin`; default `manager`. Unknown presets are rejected.
- Graceful shutdown closes the gateway, HTTP server, and DB.
- Structured pino JSON logs with fields `correlation_id`, `request_id`, `trace_id`, `span_id`, `method`, `path`, `status`, `ip`, `latency`, `user_name`.

### 13.1 Getting started doc (`docs/getting-started.md`)

Covers, step by step: creating the Discord application; adding the bot and enabling privileged intents (Server Members, Message Content if wanted); copying `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`; setting the OAuth redirect URI to `PUBLIC_BASE_URL/callback`; generating the invite URL with `invite-url`; placing the bot role high enough in the guild role list; writing `config.yaml`; running `--check`; connecting via `claude mcp add` in stdio mode and in HTTP mode; and a manual smoke checklist. Also explains that a bot identity is required (actions and gateway events), and the user login only establishes admin identity.

## 14. Testing

- Unit tests per module; vitest coverage gate 85% lines.
- Contract tests generated from the registry: name format and uniqueness, description, tier, zod schema, `guildFrom`, destructive tools have `preview` and honor caps.
- Integration: in-memory MCP client against `FakeDiscordPort`. Covers the policy matrix (tier x guild x principal) and confirm token lifecycle (issue, expiry, replay, input mismatch, principal mismatch).
- E2E auth: full PKCE flow against a mock Discord OAuth/REST server: happy path, wrong redirect URI, replayed code, refresh rotation and reuse detection, revoked token, non-admin guild filtered out, permission demotion.
- Events: ordering, pruning, gap marker, per-principal filtering, subscription notification.
- Rules: trigger/condition/action, cooldown, loop guard, fail-closed on owner demotion, destructive gating.
- No test requires a real Discord token; an optional manual smoke script is documented.

## 15. Definition of done (any task)

`pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` all pass; new code has tests written first; behavior matches this spec.

## 16. Agent team and ownership

| Teammate | Owns |
|---|---|
| `core` | `src/contracts/`, `src/store/`, `src/cli/`, `src/server/`, config, package/tooling/CI, README, `docs/` (including `docs/getting-started.md`) |
| `discord` | `src/discord/`, `src/events/` |
| `tools` | `src/tools/**` |
| `safety` | `src/safety/`, `src/rules/`, `src/auth/` |
| `qa` | `tests/integration/`, `tests/e2e/`, `tests/contract/`, `tests/fakes/`; final whole-branch review against this spec |

Unit tests live with the owner of the module under test (`tests/unit/<module>/`). Changes needed in another teammate's files are requested by message to the owner. `contracts/` is delivered first and any later change is made by `core` on request.

## 17. Open risks

- discord.js API surface for some newer endpoints may require raw REST calls behind `DiscordPort`; acceptable.
- Real Discord behavior (rate limits, permissions hierarchy) is only covered by fakes; a manual smoke checklist is provided in `docs/`.
