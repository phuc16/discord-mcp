# Smoke checklist

Run manually against a throwaway guild with `max_tier: destructive` before using a real guild.

- [ ] `discord-mcp --check --online` reports `ok`.
- [ ] Read tool: `guild_get` returns the guild.
- [ ] Write tool: `channels_create` creates a channel; `channels_update` renames it.
- [ ] Destructive with elicitation: `channels_delete` from a client that supports elicitation shows the preview, and accepting deletes the channel; declining deletes nothing.
- [ ] Destructive fail closed: from a client without elicitation and `safety.allow_token_confirm: false`, `channels_delete` returns `confirm_required` with no token and deletes nothing.
- [ ] Token flow (only with `safety.allow_token_confirm: true`): the call returns a preview and token; repeating it with the token deletes the channel, and reusing the token fails with `confirm_invalid`.
- [ ] Tier cap: with `max_tier: write`, a destructive tool returns `tier_exceeded`.
- [ ] Rule trigger: create a `member_join` rule that assigns a role; join with a test account; the role is assigned and the audit log shows the rule action.
- [ ] Event poll: `events_poll` returns the join event; after a gateway reconnect a `gap` event appears.
- [ ] OAuth login (HTTP): `claude mcp add --transport http`, authenticate with Discord, `server_whoami` shows your guilds.
- [ ] Non-admin denied: a Discord account without Administrator or Manage Server gets no guilds and tool calls return `guild_not_allowed`.
- [ ] Revoke: revoke the session; the next call returns 401.
- [ ] `GET /healthz` returns `status`, `gateway` and `db`, and HTTP 503 while the gateway is disconnected.
- [ ] A second server process on the same `database_path` refuses to start with an "already in use" message.
