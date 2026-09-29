# discord-mcp

An MCP server for managing Discord guilds from Claude Code and other MCP clients. About 90 tools across guilds, channels, threads, roles, members, moderation, messages, webhooks, scheduled events, invites, emojis and the audit log, plus live event streaming and an automation rules engine.

Every call runs through one safety pipeline: an explicit per-guild allowlist and tier cap, Discord-permission-based caps for logged-in users, a dry-run preview with a single-use confirm token for destructive tools, bulk rate limits, and an audit row for every outcome.

## Quickstart

```bash
pnpm install
pnpm build
export DISCORD_BOT_TOKEN=<bot token>
export DISCORD_CLIENT_ID=<application id>
node dist/cli/main.js invite-url --permissions manager
cp config.example.yaml config.yaml
node dist/cli/main.js --check --config config.yaml --online
claude mcp add discord -e DISCORD_BOT_TOKEN=$DISCORD_BOT_TOKEN -- node $PWD/dist/cli/main.js --config $PWD/config.yaml
```

Full setup, including Discord application creation and HTTP mode with OAuth login: [docs/getting-started.md](docs/getting-started.md). Manual verification: [docs/smoke-checklist.md](docs/smoke-checklist.md).

## Tool groups

| Group | Examples |
|---|---|
| guild | `guild_get`, `guild_update`, `guild_prune` |
| channels, threads | `channels_create`, `channels_delete`, `threads_create`, `forum_create_post` |
| roles, members | `roles_assign`, `roles_bulk_assign`, `members_update_nick` |
| moderation | `mod_timeout`, `mod_kick`, `mod_ban`, `automod_create_rule` |
| messages | `messages_send`, `messages_purge`, `reactions_add` |
| webhooks, invites, emojis | `webhooks_create`, `invites_create`, `emojis_create` |
| scheduled events | `sevents_create`, `sevents_list_users` |
| audit log | `audit_log_list`, `audit_log_by_user` |
| meta | `server_whoami`, `server_policy`, `events_poll`, `rules_create`, `rules_test`, `audit_query` |

## Safety model

- Tiers: `read`, `write`, `destructive`. Each configured guild has a `max_tier`; tool names in `tools.deny` are never registered.
- stdio: the config policy governs. HTTP: the effective tier is also capped by the caller's Discord permissions in that guild.
- Destructive tools first return `confirm_required` with a preview and a `confirm_token` (single use, 5 minutes, bound to the exact input and caller). Repeat the call with the token to execute. Clients that support MCP elicitation are asked in-band instead.
- `messages_purge` is capped at 1000 messages per call; `roles_bulk_assign` and `mod_bulk_ban` at 200 targets.
- Rules run through the same pipeline; destructive rule actions need `allow_destructive` and are disabled automatically if the owner loses permission.

## Configuration

See [config.example.yaml](config.example.yaml). Secrets come from the environment: `DISCORD_BOT_TOKEN`, and for HTTP `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUBLIC_BASE_URL`. Optional: `LOG_LEVEL` (default `info`). The config path comes from `--config` or `DISCORD_MCP_CONFIG`. Tokens are opaque random values stored hashed, so no signing key is needed.

## Development

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:cov
pnpm build
pnpm check
```

`pnpm check` runs typecheck, lint, tests and build. Import boundaries between `src/` modules and the rule that `discord.js` is imported only in `src/discord/` are enforced by eslint.
