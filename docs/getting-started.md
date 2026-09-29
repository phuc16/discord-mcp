# Getting started

discord-mcp needs a Discord **bot identity**: every action goes out as the bot and live events arrive over the bot's gateway connection. The optional OAuth login over HTTP only proves which Discord admin is calling; it never acts as the user.

## 1. Create the Discord application

1. Open the [Discord developer portal](https://discord.com/developers/applications) and create an application.
2. Copy the **Application ID**. This is `DISCORD_CLIENT_ID`.
3. Under **OAuth2**, copy the **Client Secret**. This is `DISCORD_CLIENT_SECRET` (HTTP mode only).

## 2. Add the bot and enable intents

1. Open the **Bot** tab and create the bot. Copy its token. This is `DISCORD_BOT_TOKEN`.
2. Enable the privileged **Server Members Intent**.
3. Enable **Message Content Intent** only if you want message content in events, and set `message_content_intent: true` in the config.

## 3. Set the OAuth redirect URI (HTTP mode)

Under **OAuth2 > Redirects**, add `PUBLIC_BASE_URL/callback`, for example `https://mcp.example.com/callback`.

## 4. Invite the bot

```bash
export DISCORD_CLIENT_ID=<application id>
discord-mcp invite-url --permissions manager
```

Presets are `read`, `moderator`, `manager` (default) and `admin`. A numeric permission bitfield is also accepted. Open the printed URL and pick your guild.

## 5. Order the bot role

In **Server Settings > Roles**, drag the bot's role above every role it must manage. Discord refuses to edit roles at or above the bot's own.

## 6. Write `config.yaml`

Start from [config.example.yaml](../config.example.yaml). Every guild the server may touch must be listed with a `max_tier` of `read`, `write` or `destructive`.

## 7. Check it

```bash
export DISCORD_BOT_TOKEN=<bot token>
discord-mcp --check --config config.yaml
discord-mcp --check --config config.yaml --online
```

`--check` validates the config file and required environment variables. `--online` also confirms the bot is a member of each configured guild. Add `--http` to require the HTTP variables: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `PUBLIC_BASE_URL` and `TOKEN_SIGNING_KEY`.

## 8. Connect Claude Code

stdio (the config policy governs; no login):

```bash
claude mcp add discord -e DISCORD_BOT_TOKEN=<bot token> -- discord-mcp --config /path/to/config.yaml
```

HTTP (Discord OAuth login, tools capped by the caller's Discord permissions):

```bash
discord-mcp --http --config /path/to/config.yaml
claude mcp add --transport http discord https://mcp.example.com/mcp
```

Then run `/mcp` in Claude Code and authenticate with Discord. Only guilds where you are an administrator or hold Manage Server, and where the bot is present and allowed by the config, become available.

## 9. Smoke test

Follow the [smoke checklist](smoke-checklist.md) against a throwaway guild before pointing the server at a real one.
