# Smoke checklist

Run manually against a throwaway guild with `max_tier: destructive` before using a real guild.

- [ ] `discord-mcp --check --online` reports `ok`.
- [ ] Read tool: `guild_get` returns the guild.
- [ ] Write tool: `channels_create` creates a channel; `channels_update` renames it.
- [ ] Destructive preview: `channels_delete` without `confirm_token` returns `confirm_required` with a preview and token and deletes nothing.
- [ ] Destructive confirm: repeat with the token; the channel is deleted. Repeating the token fails with `confirm_invalid`.
- [ ] Tier cap: with `max_tier: write`, a destructive tool returns `tier_exceeded`.
- [ ] Rule trigger: create a `member_join` rule that assigns a role; join with a test account; the role is assigned and the audit log shows the rule action.
- [ ] Event poll: `events_poll` returns the join event; after a gateway reconnect a `gap` event appears.
- [ ] OAuth login (HTTP): `claude mcp add --transport http`, authenticate with Discord, `server_whoami` shows your guilds.
- [ ] Non-admin denied: a Discord account without Administrator or Manage Server gets no guilds and tool calls return `guild_not_allowed`.
- [ ] Revoke: revoke the session; the next call returns 401.
- [ ] `GET /healthz` returns `status`, `gateway` and `db`.
