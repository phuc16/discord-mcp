# Getting started

This is the short path. The [README](../README.md) is the full tutorial (configuration reference, tool table, rules, troubleshooting).

discord-mcp needs a Discord **bot identity**: every action goes out as the bot and live events arrive over the bot's gateway connection. The optional OAuth login over HTTP only proves which Discord admin is calling; it never acts as the user.

In this page `discord-mcp` means `node /absolute/path/to/discord-mcp/dist/cli/main.js` after `pnpm install && pnpm build` (Node 22 and pnpm required).

## 1. Create the Discord application

1. Open the [Discord developer portal](https://discord.com/developers/applications) and create an application.
2. Copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
3. Under **OAuth2**, copy the **Client Secret**. This is `DISCORD_CLIENT_SECRET` (HTTP mode only).

## 2. Add the bot and enable intents

1. Open the **Bot** tab and reset the token. Copy it. This is `DISCORD_BOT_TOKEN`.
2. Enable the privileged **Server Members Intent**. Without it startup fails with `Used disallowed intents`.
3. Enable **Message Content Intent** only if you want message content in events, and set `message_content_intent: true` in the config.

## 3. Set the OAuth redirect URI (HTTP mode)

Under **OAuth2 > Redirects**, add `PUBLIC_BASE_URL/callback`, for example `https://mcp.example.com/callback`. It must match `PUBLIC_BASE_URL` exactly.

## 4. Invite the bot

```bash
discord-mcp invite-url --client-id <application id> --permissions manager
```

Presets are `read`, `moderator`, `manager` (default) and `admin`. A numeric permission bitfield is also accepted. Open the printed URL and pick your guild.

## 5. Order the bot role

In **Server Settings > Roles**, drag the bot's role above every role it must manage. Discord refuses to edit roles at or above the bot's own.

## 6. Write `.env` and `config.yaml`

```bash
cp .env.example .env
cp config.example.yaml config.yaml
```

Put the tokens in `.env` (read from the current directory at startup). In `config.yaml` list every guild the server may touch with a `max_tier` of `read`, `write` or `destructive`; see [config.example.yaml](../config.example.yaml) and the README for every field.

Optional environment: `DISCORD_MCP_CONFIG` is the config path used when `--config` is not given (default `config.yaml`); `LOG_LEVEL` is the pino level for logs on stderr (default `info`).

## 7. Check it

```bash
discord-mcp --check --config config.yaml
discord-mcp --check --config config.yaml --online
```

`--check` validates the config file and required environment variables. `--online` also confirms the bot is a member of each configured guild. Add `--http` to require the HTTP variables: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` and `PUBLIC_BASE_URL`.

## 8. Connect Claude Code

stdio (the config policy governs; no login):

```bash
claude mcp add discord -e DISCORD_BOT_TOKEN=<bot token> -e DISCORD_MCP_CONFIG=/absolute/path/config.yaml -- node /absolute/path/discord-mcp/dist/cli/main.js
```

HTTP (Discord OAuth login, tools capped by the caller's Discord permissions):

```bash
discord-mcp --http --config /absolute/path/config.yaml
claude mcp add --transport http discord https://mcp.example.com/mcp
```

Then run `/mcp` in Claude Code and authenticate with Discord. Only guilds where you are an administrator or hold Manage Server, and where the bot is present and allowed by the config, become available. Claude Desktop and running under supervisord are covered in the README.

## 9. Live events over HTTP

HTTP mode keeps one MCP session per client. Subscribe to `discord://guild/{guild_id}/events` and the server pushes `resources/updated` over the session's stream. Sessions are bound to the authenticated caller, capped in number, and expire after 30 minutes idle. If your client cannot hold a stream open, poll with the `events_poll` tool using the last seen event id.

## 10. Smoke test

Follow the [smoke checklist](smoke-checklist.md) against a throwaway guild before pointing the server at a real one.
