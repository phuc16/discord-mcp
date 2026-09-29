# discord-mcp

An MCP server that lets Claude Code, Claude Desktop and other MCP clients manage Discord guilds. It exposes 102 tools (channels, threads, roles, members, moderation, messages, webhooks, scheduled events, invites, emojis, audit log), live gateway events, and an automation rules engine, all behind one safety pipeline.

This README is the full tutorial. For the short version see [docs/getting-started.md](docs/getting-started.md); for manual verification see [docs/smoke-checklist.md](docs/smoke-checklist.md).

## Contents

1. [What it is and how it works](#1-what-it-is-and-how-it-works)
2. [Prerequisites](#2-prerequisites)
3. [Discord developer portal setup](#3-discord-developer-portal-setup)
4. [Install and build](#4-install-and-build)
5. [Configure](#5-configure)
6. [Verify](#6-verify)
7. [Use it](#7-use-it)
8. [Using the tools](#8-using-the-tools)
9. [Events and rules](#9-events-and-rules)
10. [Tool reference](#10-tool-reference)
11. [Security notes and known limitations](#11-security-notes-and-known-limitations)
12. [Troubleshooting](#12-troubleshooting)
13. [Development](#13-development)

## 1. What it is and how it works

discord-mcp runs as **a Discord bot that you own**. Every action goes out as the bot, and live events (joins, messages, role changes) arrive over the bot's gateway connection. That is why a bot identity is always required.

The MCP client talks to the server in one of two ways:

- **stdio** (default): the client launches the server as a subprocess. There is no login. What the client may do is decided only by `config.yaml`.
- **HTTP** (`--http`): the server is a long-lived service. Clients log in through OAuth with their Discord account. The login only establishes *who is calling*; it never acts as that user. The caller's Discord permissions cap what they may do (an administrator gets everything the config allows; a user with only Manage Server is capped lower).

Every tool call, including calls made by automation rules, passes one pipeline: input validation, guild allowlist, tier check, bulk rate limit, dry-run confirmation for destructive tools, and an audit row for every outcome.

Tiers, from lowest to highest: `read`, `write`, `destructive`. Each guild in `config.yaml` has a `max_tier`; a caller's effective tier is the lower of that and what their Discord permissions allow (stdio callers get the config tier).

## 2. Prerequisites

- Node.js 22 or newer
- pnpm (`corepack enable pnpm` or `npm i -g pnpm`)
- A Discord account that can create applications and manage the target guild
- Optional: the `claude` CLI (Claude Code) or Claude Desktop as the MCP client

## 3. Discord developer portal setup

1. Open <https://discord.com/developers/applications> and choose **New Application**.
2. On **General Information**, copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
3. Open **Bot** and choose **Reset Token**. Copy the token. This is `DISCORD_BOT_TOKEN`. It is shown once; never commit it.
4. Still on **Bot**, under **Privileged Gateway Intents**, enable **Server Members Intent**. This is required: without it startup fails with `Used disallowed intents`. Enable **Message Content Intent** only if you want message text in events, and then also set `message_content_intent: true` in `config.yaml`.
5. HTTP mode only: open **OAuth2**, copy the **Client Secret** (`DISCORD_CLIENT_SECRET`), and under **Redirects** add `<PUBLIC_BASE_URL>/callback`, for example `https://mcp.example.com/callback` or `http://localhost:8787/callback`. It must match `PUBLIC_BASE_URL` exactly.
6. Generate the bot invite URL (after step 4 in the next section you can run this; it needs only the client id):

   ```bash
   node dist/cli/main.js invite-url --client-id <application id> --permissions manager
   ```

   Presets are cumulative: `read` (view channels, read history, view audit log), `moderator` (adds kick, ban, timeout, manage messages and threads), `manager` (adds manage channels, server, roles, webhooks, expressions, events, invites, send, react, embed; the default) and `admin` (Administrator). A numeric permission bitfield is also accepted; an unknown preset exits non-zero. If `DISCORD_CLIENT_ID` is set you can omit `--client-id`.
7. Open the printed URL, pick your guild and authorise.
8. In Discord, open **Server Settings > Roles** and drag the bot's role **above every role it must manage**. Discord refuses to edit any role, or any member holding a role, at or above the bot's highest role.

## 4. Install and build

```bash
git clone <this repository> discord-mcp
cd discord-mcp
pnpm install
pnpm build
```

The build produces `dist/cli/main.js`. In this README, `discord-mcp` means `node /absolute/path/to/discord-mcp/dist/cli/main.js` (the file is executable and has a shebang, so you can also put it on your `PATH`).

## 5. Configure

### 5.1 `.env`

```bash
cp .env.example .env
```

The CLI reads `.env` from the current directory at startup; variables already in the environment win. Never commit `.env`.

| Variable | Needed for | Meaning |
|---|---|---|
| `DISCORD_BOT_TOKEN` | always | Bot token from step 3.3 |
| `DISCORD_CLIENT_ID` | HTTP, `invite-url` | Application ID |
| `DISCORD_CLIENT_SECRET` | HTTP | OAuth2 client secret |
| `PUBLIC_BASE_URL` | HTTP | Public URL of this server, no trailing slash; OAuth metadata and the Discord redirect are built from it |
| `DISCORD_MCP_CONFIG` | optional | Config path when `--config` is not given (default `config.yaml`) |
| `LOG_LEVEL` | optional | pino level, default `info`; logs are JSON on stderr |

### 5.2 `config.yaml`

```bash
cp config.example.yaml config.yaml
```

```yaml
guilds:
  "123456789012345678":
    max_tier: destructive
tools:
  deny: []
rate_limits:
  bulk_per_minute: 5
events:
  retention_hours: 72
  max_buffer: 50000
http:
  host: 127.0.0.1
  port: 8787
  trust_proxy: false
  allowed_redirect_uris: []
  max_clients: 1000
  max_sessions_per_principal: 10
  service_tokens: []
safety:
  allow_token_confirm: false
rules:
  max_per_guild: 50
  min_cooldown_sec: 1
message_content_intent: false
database_path: ./discord-mcp.db
```

| Field | Meaning |
|---|---|
| `guilds` | **Allowlist.** Keys are guild ids (snowflakes, quoted). At least one is required. Any guild not listed is unreachable for every tool, rule and event. |
| `guilds.<id>.max_tier` | `read`, `write` or `destructive`: the highest tier any caller may reach in that guild. Use `read` for a guild you only want to observe. |
| `tools.deny` | Tool names that are never registered and never run, for example `[guild_prune, mod_bulk_ban]`. |
| `rate_limits.bulk_per_minute` | Per-guild token bucket for the bulk tools `messages_purge`, `roles_bulk_assign`, `mod_bulk_ban` and `guild_prune`. Default 5. |
| `events.retention_hours` | Buffered gateway events older than this are pruned. Default 72. |
| `events.max_buffer` | Maximum buffered events; the oldest are dropped first. Default 50000. |
| `http.host`, `http.port` | Bind address for `--http`. Defaults `127.0.0.1` and `8787`. Set `host: 0.0.0.0` explicitly only when the server runs in a container or behind a reverse proxy that reaches it over the network. |
| `http.trust_proxy` | Whether to believe `X-Forwarded-For` for client IPs (rate limits and logs). `false` (default), `true`, a number of proxy hops (`1` for one reverse proxy) or a CIDR list string. Leave `false` unless a reverse proxy you control sets the header; otherwise clients can spoof their IP and dodge per-IP limits. |
| `http.allowed_redirect_uris` | Exact redirect URIs OAuth clients may register and use. Empty (default) allows `https` URIs and loopback `http://127.0.0.1`, `http://localhost` and `http://[::1]` on any port and path. |
| `http.max_clients` | Cap on dynamically registered OAuth clients. Default 1000. |
| `http.max_sessions_per_principal` | Cap on concurrent MCP sessions per logged-in user or service token, besides the global cap. Default 10. An open event stream counts as activity for the idle sweep. |
| `safety.allow_token_confirm` | Default `false`: destructive calls require a client that supports MCP elicitation and are confirmed in-band. If the client cannot elicit, the call fails closed with `confirm_required` and no token. Set `true` to also allow the two-step `confirm_token` flow (section 8.1). |
| `rules.max_per_guild` | Maximum automation rules per guild. Default 50. |
| `rules.min_cooldown_sec` | Minimum `cooldown_sec` a rule may have. Default 1. |
| `http.service_tokens` | Static bearer tokens for automation, as `{ name, sha256 }` where `sha256` is the hex SHA-256 of the token. A service token is governed only by the config policy (like stdio). Create one with `printf '%s' "$TOKEN" \| shasum -a 256`. |
| `message_content_intent` | Set `true` only after enabling Message Content Intent in the portal. Without it, message events omit `content`. |
| `database_path` | SQLite file for audit, confirmations, events, rules and OAuth state. Use a persistent path when running as a service. A relative path is resolved against the directory of the config file, not the working directory. Only one process may use a database: a second instance on the same file refuses to start (lock file `<database_path>.lock`; a stale lock from a crashed process is taken over). |

Ensure the guild ids are the ones you invited the bot to (right-click the server in Discord with Developer Mode on and choose **Copy Server ID**).

## 6. Verify

```bash
discord-mcp --check --config config.yaml
discord-mcp --check --config config.yaml --online
```

- Without `--online`, `--check` validates the config file (every failing field is listed as `path: message`) and the required environment variables, and opens an in-memory store.
- `--online` also connects with the bot token and confirms the bot is a member of every configured guild.
- Add `--http` to also require `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `PUBLIC_BASE_URL`.

Success prints `ok` and exits 0; otherwise each problem is printed as `- <problem>` and the exit code is 1.

## 7. Use it

### 7.1 Claude Code, stdio

```bash
claude mcp add discord \
  -e DISCORD_BOT_TOKEN=<bot token> \
  -e DISCORD_MCP_CONFIG=/absolute/path/config.yaml \
  -- node /absolute/path/discord-mcp/dist/cli/main.js
```

Use absolute paths: Claude Code starts the process from its own working directory, so the relative `.env` and `config.yaml` will not be found unless you pass `-e` and `--config`. Then run `/mcp` in Claude Code to see the server and try `server_whoami`.

### 7.2 Claude Desktop, stdio

Edit `claude_desktop_config.json` (Settings > Developer > Edit Config):

```json
{
  "mcpServers": {
    "discord": {
      "command": "node",
      "args": ["/absolute/path/discord-mcp/dist/cli/main.js", "--config", "/absolute/path/config.yaml"],
      "env": { "DISCORD_BOT_TOKEN": "<bot token>" }
    }
  }
}
```

Restart Claude Desktop. Logs go to stderr and appear in the client's MCP log.

### 7.3 HTTP mode with OAuth login

Run the server as a long-lived service:

```bash
discord-mcp --http --config config.yaml
```

Endpoints: `POST/GET/DELETE /mcp` (streamable HTTP), `GET /healthz` (`{"status":"ok","gateway":"ready","db":"ok"}`, or HTTP 503 with `"status":"degraded"` when the gateway is not ready or the database fails), the OAuth endpoints (`/authorize`, `/token`, `/register`, `/revoke`, `/callback`) and the two `.well-known` metadata documents.

`PUBLIC_BASE_URL` must be the URL clients use to reach the server (put TLS in front of it in production, for example a reverse proxy), and `<PUBLIC_BASE_URL>/callback` must be registered as a redirect in the Discord portal.

Connect Claude Code:

```bash
claude mcp add --transport http discord https://mcp.example.com/mcp
```

Then run `/mcp` in Claude Code and choose **Authenticate**. The flow:

1. The client registers itself (dynamic client registration) and sends you to `/authorize` with PKCE.
2. The server redirects you to Discord to log in (`identify guilds` scopes).
3. On `/callback` the server keeps only guilds where you are an Administrator or hold Manage Server, the bot is present, and the guild is in `config.yaml`. If there are none you get `access_denied`.
4. The client receives a one-hour access token and a 30-day rotating refresh token (both opaque, stored hashed).

Your permissions are re-read on token refresh and whenever a role or member event touches you. If you lose the permission, that guild is dropped from your session and any rules you own there are disabled.

For scripts and CI, use a service token instead of logging in: add its hash to `http.service_tokens` and pass `--header "Authorization: Bearer <token>"` to `claude mcp add --transport http`.

### 7.4 Running as a service (Docker, supervisord)

HTTP mode is meant to run under a supervisor. In the `all-in-one` container that runs services under supervisord, add a program such as:

```ini
[program:discord-mcp]
command=node /opt/discord-mcp/dist/cli/main.js --http --config /etc/discord-mcp/config.yaml
directory=/opt/discord-mcp
environment=DISCORD_MCP_CONFIG="/etc/discord-mcp/config.yaml",LOG_LEVEL="info"
autorestart=true
stdout_logfile=/var/log/discord-mcp.out.log
stderr_logfile=/var/log/discord-mcp.err.log
```

The default bind is `127.0.0.1`, which is unreachable from outside the container. Set `http.host: 0.0.0.0` in the config, put a TLS reverse proxy in front, and set `http.trust_proxy: 1` (the number of proxies) so client IPs come from `X-Forwarded-For`; without a proxy, keep `trust_proxy: false`.

Provide `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `PUBLIC_BASE_URL` through the container environment or a `.env` file in `directory`, and keep `database_path` on a mounted volume so audit, rules and sessions survive restarts. After changing config or deploying a new build, restart it:

```bash
docker exec all-in-one supervisorctl restart discord-mcp
```

SIGINT, SIGTERM and SIGHUP close the gateway, the HTTP server and the database cleanly, and `/healthz` can be used as the container health check.

## 8. Using the tools

Ask in plain language; the client picks the tools. Examples by group:

| Group | Example prompt |
|---|---|
| guild | "Show me the details and member count of guild 1234…", "Rename the server to Lounge." |
| channels | "List the channels", "Create a text channel called announcements under the Info category", "Make #staff private to the Mods role." |
| threads | "List active threads", "Start a thread on that message called Follow-up", "Create a forum post in #help." |
| roles | "Create a Helper role with a blue colour", "Give @alice the Helper role", "Assign Helper to these 30 users." |
| members | "Find members named bob", "Change @carol's nickname", "Move @dave to the Lobby voice channel." |
| moderation | "Time out @erin for 10 minutes", "Ban @mallory and delete the last day of messages", "Create an automod rule that blocks invite links." |
| messages | "Post the rules in #welcome", "Pin that message", "Delete the last 200 messages from @spammer in #general." |
| webhooks | "Create a webhook in #alerts and post a test message." |
| scheduled_events | "Schedule a movie night Friday 20:00 in the Stage channel." |
| invites | "Create a one-day invite to #welcome that can be used 10 times." |
| emojis | "Upload this image as an emoji called party." |
| audit_log | "Who deleted channels in the last few days?" |
| meta | "Who am I here and what tier do I have?", "What happened in the guild since event 500?" |

### 8.1 Destructive confirmation

Destructive tools never act on the first call. By default they need a client that supports MCP elicitation: the client asks you to confirm the preview in-band, and the call runs only if you accept. If the client cannot elicit (or elicitation fails), the call fails closed with `confirm_required` and no token, and nothing changes. To allow the token flow below for such clients, set `safety.allow_token_confirm: true`; with it off, a declined confirmation is simply denied.

With `safety.allow_token_confirm: true`, asking "delete the #old-news channel" produces a `channels_delete` call that returns an error result like:

```json
{
  "error": {
    "code": "confirm_required",
    "message": "confirmation required",
    "details": {
      "preview": { "summary": "Delete channel #old-news", "affected": { "channels": 1 } },
      "confirm_token": "…",
      "expires_in_sec": 300
    }
  }
}
```

The client shows you the preview. If you agree, it repeats the same call with `confirm_token`. The token is single use, valid for 5 minutes, and bound to the exact input and the caller. Consequently:

- Replaying a used token returns `confirm_invalid`.
- Changing any argument, using another caller, or waiting past 5 minutes returns `confirm_invalid`.
- A `confirm_required` response is a dry run: nothing was changed, and the audit log records it with outcome `dry_run`.
- Clients that support MCP elicitation are always asked to confirm in-band first; the token is only returned when elicitation is unavailable or declined.
- Caps: `messages_purge` removes at most 1000 messages per call; `roles_bulk_assign` and `mod_bulk_ban` at most 200 targets per call.

### 8.2 Audit trail

Every call writes an audit row with outcome `ok`, `dry_run`, `denied` or `error`, the tool, tier, guild, actor, a hash of the input (never the raw input) and latency. Read it with `audit_query` ("show the last 20 bans in this guild"), filtering by tool or actor; callers only see guilds they can read. Discord's own audit log shows the bot's actions with a reason of the form `via discord-mcp by <user> (<correlation id>)`.

## 9. Events and rules

### 9.1 Events

The bot buffers gateway events per allowlisted guild: `message_create`, `message_update`, `message_delete`, `member_join`, `member_remove`, `member_ban`, `member_unban`, `role_create`, `role_update`, `role_delete`, `channel_create`, `channel_update`, `channel_delete`, `voice_state`, `scheduled_event` and `gap`. A `gap` event marks a gateway reconnect during which events may have been missed.

- **Polling:** `events_poll` with `guild_id`, `since_id` (start at 0), optional `types` and `limit` (max 500). It returns `items` and a `next_cursor`; pass the last id back as `since_id`.
- **Subscription:** subscribe to the resource `discord://guild/{guild_id}/events`; the server sends `notifications/resources/updated` when new events arrive and you read the resource to fetch them. This works over stdio and, because HTTP sessions are stateful, over HTTP too. If your client cannot hold a stream, poll.

### 9.2 Rules

A rule reacts to an event and runs tools. Ask Claude to create it with `rules_create`, or give the arguments directly. Placeholders `{{event.data.<key>}}` and `{{event.guild_id}}` in `input_template` are filled from the event; a missing key fails the action. Rules with `allow_destructive: true` or destructive actions cannot be created with `rules_create`/`rules_update`; use `rules_create_destructive`/`rules_update_destructive`, which go through the destructive confirmation (8.1).

Welcome role on join:

```json
{
  "guild_id": "123456789012345678",
  "trigger": { "event": "member_join" },
  "actions": [
    { "tool": "roles_assign",
      "input_template": { "guild_id": "{{event.guild_id}}", "user_id": "{{event.data.user_id}}", "role_id": "222222222222222222" } }
  ]
}
```

Greet new members, but not accounts younger than a week (a condition):

```json
{
  "guild_id": "123456789012345678",
  "trigger": { "event": "member_join" },
  "conditions": [ { "op": "account_age_lt_days", "days": 7 } ],
  "actions": [
    { "tool": "roles_assign",
      "input_template": { "guild_id": "{{event.guild_id}}", "user_id": "{{event.data.user_id}}", "role_id": "333333333333333333" } }
  ],
  "cooldown_sec": 5
}
```

Flag messages containing a phrase (message content needs `message_content_intent`):

```json
{
  "guild_id": "123456789012345678",
  "trigger": { "event": "message_create" },
  "conditions": [ { "op": "message_contains", "text": "free nitro" } ],
  "actions": [
    { "tool": "messages_send",
      "input_template": { "guild_id": "{{event.guild_id}}", "channel_id": "444444444444444444", "content": "Possible scam from <@{{event.data.author_id}}>" } }
  ]
}
```

Conditions: `equals`, `matches` (regex, max 200 chars), `in`, `member_has_role`, `account_age_lt_days`, `message_contains`. The trigger `filter` is an equality map on event data. Try `rules_test` with a sample event first: it reports whether the rule matched and the rendered action inputs, and executes nothing. Manage rules with `rules_list`, `rules_update` and `rules_delete`.

Guard rails: rules run through the same pipeline as tools, as the rule owner; an owner needs at least the `write` tier in the guild; destructive actions need `allow_destructive: true` set at creation and are audited under the actor `rule:<id>`; each rule has an optional cooldown, guilds are limited to 30 rule actions a minute, an action does not retrigger the rule that caused it, and a rule is disabled automatically if its owner loses permission.

## 10. Tool reference

Tier: **R** read, **W** write, **D** destructive (dry-run preview then `confirm_token`). Every tool takes `guild_id` except the unscoped read tools marked with `*`.

| Group | Tools |
|---|---|
| guild | `guild_list` R*, `guild_get` R, `guild_update` W, `guild_get_preview` R, `guild_get_prune_count` R, `guild_prune` D, `guild_get_widget` R, `guild_update_widget` W |
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
| meta | `server_whoami` R*, `server_policy` R*, `events_poll` R, `rules_create` W, `rules_list` R, `rules_update` W, `rules_create_destructive` D, `rules_update_destructive` D, `rules_delete` W, `rules_test` R, `audit_query` R |

`server_policy` shows your effective tier per guild and the denied tools. Tools that act through a channel, webhook or invite id check that the resource belongs to the given `guild_id` before acting.

## 11. Security notes and known limitations

- **Secrets:** the bot token, client secret and every token are excluded from logs (pino redaction plus a test that greps all responses and log lines). Keep `.env` and `config.yaml` out of version control.
- **Least privilege:** invite with the smallest preset you need, list only the guilds you need, and set `max_tier: read` where you only observe. Use `tools.deny` for tools you never want.
- **Guild binding:** an allowlisted `guild_id` cannot be used against a channel, webhook or invite of another guild.
- **OAuth:** PKCE S256 is required, redirect URIs match exactly, `state` is single use with a 10-minute TTL, refresh tokens rotate and reuse of a rotated token revokes the whole session family, and CORS on the token endpoints is limited to registered redirect origins.
- **Dynamic client registration is open** and accepts any redirect URI, as the MCP authorization spec expects. Clients are always public (no client secret); the consent step is Discord's. If you need to restrict who can register, put registration behind network controls.
- **Rule actions with `allow_destructive`** run without a confirm token by design once created (creating them needs the destructive tier and confirmation); they are audited under `rule:<id>`.
- **Bulk rate limit:** the limiter takes a token before the dry-run step, so a `confirm_required` response also consumes one bulk slot.
- **CORS preflight on `/mcp`:** `OPTIONS /mcp` returns 401 (the bearer check runs first), so browser-based cross-origin MCP clients cannot call `/mcp`.
- **Message content:** without the Message Content intent, `message_contains` conditions never match and events carry no text.
- **Discord API limits:** OAuth `fetchUserGuilds` returns at most 200 guilds; bulk message deletion skips messages older than 14 days.
- **Single process:** one instance owns the gateway connection and the SQLite database; do not run two against the same database.

## 12. Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Startup fails with `Used disallowed intents` | Enable **Server Members Intent** (and Message Content Intent if `message_content_intent: true`) on the Bot page of the developer portal. |
| `--check` lists `missing env var …` | Set it in `.env` or the environment. Relative `.env` is read from the current directory only. |
| `--check --online`: `bot is not a member of configured guild …` | Invite the bot with `invite-url`, or fix the guild id in `config.yaml`. |
| `missing_permissions` | The bot lacks the Discord permission. Re-invite with a higher preset or grant the permission to the bot's role. |
| Role or member edits fail with `missing_permissions` | Role hierarchy: move the bot's role above the roles and members it must manage. The bot can never edit the owner. |
| `guild_not_allowed` | The guild is not in `config.yaml`, or (HTTP) you are not an administrator or Manage Server holder there, or the bot is not present. |
| `tier_exceeded` | The tool's tier is above the effective tier: raise `max_tier`, or your Discord permissions cap you. `server_policy` shows the effective tier per guild. The tool may also be in `tools.deny`. |
| `confirm_required` on every destructive call | Your client does not support MCP elicitation. Use one that does, or set `safety.allow_token_confirm: true` and repeat the call with the returned `confirm_token`. `confirm_invalid` means the token was used, expired, or the input changed. |
| `rate_limited` | Bulk limiter (`rate_limits.bulk_per_minute`, wait `details.retry_after`) or Discord's own limit (429; the details carry `retry_after` seconds). The OAuth endpoints also rate limit a single IP, returning HTTP 429. |
| `not_found` | Wrong id, or the resource belongs to another guild than `guild_id`. |
| HTTP 401 with `WWW-Authenticate` | Not logged in or the token expired or was revoked: re-authenticate with `/mcp`. |
| Login ends with `access_denied` | None of your guilds qualify (Administrator or Manage Server, bot present, allowlisted). |
| `redirect_uri` mismatch at Discord | `<PUBLIC_BASE_URL>/callback` must be registered exactly in the portal. |
| `database ... is already in use` at startup | Another discord-mcp process is using that database. Stop it, or use a different `database_path`. |
| No events arrive | Check `/healthz` for `gateway: ready`, that the guild is in `config.yaml`, and the intents. A `gap` event marks a reconnect. |

## 13. Development

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm test:cov
pnpm build
pnpm check
```

`pnpm check` runs typecheck, lint, tests and build. Import boundaries between `src/` modules, and the rule that `discord.js` is imported only inside `src/discord/`, are enforced by eslint. The design is in `docs/superpowers/specs/2026-09-29-discord-mcp-design.md` and the whole-branch review in `docs/review-2026-09-29.md`.
