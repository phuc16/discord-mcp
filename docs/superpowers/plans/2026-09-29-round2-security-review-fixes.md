# Round 2: security audit and code review fixes

Source: four read-only reviews of `feat/discord-mcp` (two security audits, two code reviews). This file is the work order. Each teammate works only on its own section and only in files it owns (see the ownership table in `2026-09-29-discord-mcp.md`, "Agent Team Execution"). Work test-first. Definition of done per item: tests pass and `pnpm typecheck && pnpm lint && pnpm test && pnpm build` are clean. Commit your own files only, small and often, Conventional Commits ending with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Do not push. Message the lead ("team-lead") when your section is done.

## User decisions (binding)

1. Destructive calls REQUIRE human elicitation by default. If the client cannot elicit, or elicitation errors, fail closed: return `confirm_required` with NO token. The old token-return flow exists only when config `safety.allow_token_confirm: true` (default false).
2. Enforce Discord semantics in code for `user` principals (do not drop write tools for Manage-Server users): never grant permission bits the caller lacks (Administrator only if held); never act on roles or members at or above the caller's highest role.

## Ordering

`core` lands the shared contract, config and store changes first (section core-A, core-B), commits, then messages `discord`, `tools`, `safety`, `qa` with the exact names. Others start with anything not blocked and pick up shared pieces once core announces them. A partial version of core-A already sits uncommitted in `src/contracts/config.ts` and `src/contracts/events.ts`; `core` finishes and commits it.

## core

**A. contracts/config (do first).** Config fields (defaults): `http.host` 127.0.0.1; `http.trust_proxy` (boolean | positive int hops | string CIDR list; default false); `http.allowed_redirect_uris` (string[]; default [] meaning https plus loopback `http://127.0.0.1|localhost|[::1]` any port/path); `http.max_clients` 1000; `http.max_sessions_per_principal` 10; `safety.allow_token_confirm` false; `rules.max_per_guild` 50; `rules.min_cooldown_sec` 1. Event type `member_update` (data `{user_id, username, old_roles, new_roles}`). Update `config.example.yaml`, README/getting-started and the docs test.

**B. store.** `EventRepo.since` with a `types` filter always also returns `type='gap'`. Add `EventRepo.recent(guildId, limit)` (`ORDER BY id DESC LIMIT n`, returned ascending). `store.pruneExpired(now)`: delete expired/consumed `oauth_states`, expired unconsumed `oauth_codes`, revoked or expired `oauth_sessions` with their `oauth_refresh_history`, expired `confirmations`; add an index on `oauth_sessions(refresh_expires_at)`. Client-count helper for the `max_clients` cap. `OAuthRepo` used-code to family map so safety can revoke tokens on code replay. Migrations run in an immediate transaction with the version re-read inside it, and refuse a DB whose `schema_version` is newer than known.

**C. server/cli.**
1. Use `http.trust_proxy` instead of `trust proxy: true`; default bind 127.0.0.1 (README, Docker and supervisord examples must set 0.0.0.0 explicitly and mention a reverse proxy plus `trust_proxy`). Disable `x-powered-by`. Final error middleware returns generic JSON for malformed JSON/413 (no stack, no paths). Enforce `http.max_clients` on `/register` (hook agreed with safety).
2. Per-principal session cap (`http.max_sessions_per_principal`) besides the global cap; an open SSE stream counts as activity for the idle sweep; catch `transport.close()` rejections; log `unhandledRejection` (do not exit).
3. Failed-initialize leak: create the `McpServer` and event-feed subscription only in `onsessioninitialized` (or clean up in a catch); unsubscribe on http close. Test: repeated initialize without an Accept header leaves zero subscribers.
4. stdio exits cleanly on stdin `end`/`close` and on SIGHUP.
5. Resource `discord://guild/{id}/events` returns the newest events (use `recent()`), test with more than 100 events.
6. `/healthz`: `SELECT 1` for db, 503 when the gateway is not ready.
7. `database_path` resolves relative to the config file's directory; advisory single-instance lock so a second process on the same DB refuses to start with a clear message; document it.
8. `main.ts`: `process.loadEnvFile` errors are caught and reported cleanly.
9. Run `store.pruneExpired` on a timer alongside the events prune; cache `registeredOrigins` in the auth provider (coordinate with safety).
10. README/getting-started updated for every user-visible change, including the new default that destructive calls need a client with MCP elicitation and how to opt in to the token flow. Extend the docs test.

## safety

1. **Confirm gate (High).** Implement user decision 1 in `runTool`: destructive calls run only after elicitation is accepted (all principal kinds); unsupported or throwing elicitation fails closed with `confirm_required` and no token, unless `safety.allow_token_confirm`; a decline falls back to the token flow only when that flag is true, otherwise denied. Sanitize untrusted text in preview summaries before showing them in the elicitation prompt (strip control chars and markdown/mentions, truncate). Update pipeline tests and tell `qa`.
2. **Escalation (High).** Implement user decision 2. Export from `src/safety/index.ts`: `assertCanGrantPermissions(principal, guildId, bits)` and hierarchy helpers (caller's highest role position fetched through the `DiscordPort` on the tool context; reject acting at or above it). Tell `tools` the exact signatures. Fix `GROUP_PERMS` so kick/ban/timeout each need their own bit (`KICK_MEMBERS`, `BAN_MEMBERS`, `MODERATE_MEMBERS`) and `members` actions need the specific bit per action (nickname, move members, manage roles); coordinate with `tools` if a per-tool tier map is needed.
3. **Rules bypass (High).** `rules_create`/`rules_update` with `allow_destructive` or any destructive action must require destructive tier for the creator in the rule's guild (service level check). Rule listings must not expose other owners' rules to plain readers. `tools` will split the tool into confirm-gated destructive variants; agree the service contract with `tools`.
4. **Stale permissions (High).** Refresh only the affected user on the new `member_update` event; drop member_join/remove/ban/unban from REFRESH_EVENTS unless the affected user has a session; keep `role_*`. Before a rule runs, re-verify the owner via `fetchMemberPermissions` (cache 60 s) and fail closed on error. `principalFor` must not OR bits across sessions that were not refreshed recently (use the freshest). `refreshSession` fails closed after N consecutive fetch failures instead of keeping old bits forever. `disableForOwner(userId, guildId, reason)` disables only that guild's rules.
5. **OAuth consent (High).** Before redirecting to Discord, render a consent page: GET shows `client_name` and the exact redirect URI, POST with a CSRF-bound cookie confirms. Set `prompt=consent`. Enforce `http.allowed_redirect_uris` at `/register` and `/authorize` (default https or loopback only). Bind the callback `state` to the browser with a cookie. Cache `registeredOrigins`. Require `redirect_uri` at the token exchange. On authorization-code replay revoke the family that code issued. Refresh: rotate first and refresh guilds after, or accept the immediately previous refresh token for a 10 s grace so a lost response does not kill the family. Enforce the `max_clients` cap.
6. **ReDoS (Medium).** Remove the nested-quantifier heuristic. Run `matches` in a `worker_thread` with a hard kill timeout, or drop `matches` for starts_with/ends_with/contains. Tests: `^(a|a)+$` on 30 chars, `(a|aa)+$`, `.*.*.*.*.*.*x` never block the event loop more than about 100 ms.
7. **Loop guard and rules limits (Medium).** Key the guard by correlation chain; skip events authored by the bot itself for message rules by default; enforce `rules.min_cooldown_sec` and `rules.max_per_guild` (and per owner); per-guild bounded queues so one slow guild does not stall others; tests for the webhook re-trigger and purge/bulk cases. Zod errors from rule create/update map to `invalid_input`, not `internal`.
8. **Pipeline robustness.** Wrap audit writes in try/catch and log (an audit failure after the handler ran must not turn a successful destructive action into an error); take the bulk limiter slot only on the execute path (accepted elicitation or valid token), not on previews or invalid tokens.

## tools

Use safety's helpers and core's config once announced.
1. **Escalation (Critical/High).** For user principals, in `roles_create`, `roles_update`, `channels_set_permissions`, `roles_assign`, `roles_remove`, `members_add_role`, `members_remove_role`, `mod_*` (timeout/kick/ban/bulk_ban), `members_update_nick`, `members_move_voice`/`members_disconnect_voice`: reject permission bits the caller lacks (never Administrator unless held) and reject acting on roles/members at or above the caller's highest role. Tests: a Manage-Server-only user cannot create or assign an Administrator role or a role above their own; allowed writes still work.
2. **Rules tools (High).** `rules_create`/`rules_update` refuse `allow_destructive: true` or destructive actions at write tier (`invalid_input` naming the reason). Add destructive-tier variants `rules_create_destructive` and `rules_update_destructive` with previews listing triggers and actions, going through the normal confirm flow. Agree the service contract with safety.
3. **Mentions (Medium).** `allowed_mentions: { parse: [] }` by default on `messages_send`, `messages_edit`, `forum_create_post`, `webhooks_execute`; remove `everyone` from the accepted enum (explicit user/role ids only).
4. **`messages_purge`.** Preview pins the scan (returns the newest scanned message id as `before`); execute requires that pinned `before` (or binds an id-list hash), so preview equals execution. Stop scanning at the 14-day cutoff. Keep the 14-day constants only in the port (coordinate with `discord`).
5. `members_list` `next_cursor` uses `last.user.id`; add `next_cursor` to `mod_list_bans`; `events_poll` `next_cursor` is numeric like `since_id`.
6. Forum tags: schema gets `emoji_id`, nullable `emoji_name`/`emoji_id`; `forum_list_tags` output round-trips losslessly through `forum_update_tags`; dedupe against `channels_update.available_tags`; preview when tags are dropped.
7. `threads_create` defaults `type` to 11; validate `before` ISO8601 on archived list; expose `has_more` (coordinate with `discord`).
8. Automod: `event_type` union(1,2) cross-checked with `trigger_type` (6 needs 2); guild-check `actions[].metadata.channel_id`.
9. `roles_delete` preview: bounded scan and report `at_least`. `roles_bulk_assign`: de-dupe ids, audit outcome reflects failures. `mod_bulk_ban`: de-dupe. `sevents_delete` preview shows real user counts (`discord` adds `with_user_count` to `getScheduledEvent`). `channels_clone` copies bitrate, user_limit, rate_limit_per_user, available_tags, position. `audit_log_*` tools project fields (no raw webhook/integration objects). `invites_create` rejects `max_age` 0 / `max_uses` 0 unless explicitly bounded (document). Webhook `username` length-limited.
10. Update the tier snapshot in `tests/contract` (tell `qa`).

## discord

1. Gateway partials: add `Partials.Message`, `Partials.Channel`, `Partials.GuildMember` so `message_delete`/`message_update`/`member_remove` fire for uncached objects; tests with partial fixtures.
2. Status: also listen to `shardReady`. Emit a gap only on a fresh ready after a disconnect (not on `shardResume`, which Discord replays). The gap event's data carries `disconnected_at` and `reconnected_at`.
3. New normalizer for `guildMemberUpdate` to `member_update` (only when roles changed), with tests.
4. Wrap every gateway listener body in try/catch with logging; add a client `error` listener; log swallowed subscriber errors at warn.
5. events service: fix `recent()` (use core's `EventRepo.recent`), drop unused code; message content stored only when the intent config is on (verify); per-guild retention if cheap.
6. Port fixes: sticker upload multipart field `file` (`key: 'file'`) with filename/content type from the input (png/apng/json); `getScheduledEvent` passes `with_user_count=true`; pins use the current routes (`channelMessagesPin(s)`) and list shape; `listArchivedThreads` returns `has_more` and validates `before`; `fetchUserGuilds` paginates (`after`, limit 200) and every OAuth fetch has `AbortSignal.timeout(10_000)`; `fetchMemberPermissions` uses `Promise.all`; `listGuilds` paginates; error mapping: 401 logged as internal-unauthorized, 5xx/429 mapped properly, bulk-ban with no bannable users (Discord error 500000) becomes a clean tool error; audit `reason` on scheduled-event delete; reaction emoji with `.` path segments rejected; the 14-day bulk-delete cutoff lives only in the port.
Tell `tools` and `qa` about signature changes.

## qa

1. Tighten the fakes: members and bans use the real Discord shape (`user.id`, no top-level `id`); stickers require multipart field `file`; threads/roles/automod validate like Discord; the gateway fake models partials and `shardReady`; event/gap behaviour is real.
2. Write a regression test per finding that fails on the old behaviour (confirm it fails first), then keep it as a gate test:
 - spoofed `X-Forwarded-For` does not bypass `/register` limits (default `trust_proxy=false`)
 - failed initialize leaks no subscriber; per-principal session cap
 - malformed JSON returns generic JSON with no stack/paths and no `x-powered-by`
 - consent page precedes the Discord redirect; redirect URI allowlist; code replay revokes the issued family; refresh grace
 - demotion via a `member_update` event ends access and stops the owner's rules
 - Manage-Server-only user cannot create/assign an Administrator role or act above their hierarchy
 - `rules_create` with `allow_destructive` at write tier is refused; the destructive variant needs confirmation
 - destructive tools without elicitation fail closed with no token (`allow_token_confirm=false`); the token flow works only when true
 - ReDoS patterns never block the loop; webhook/purge rule loops are bounded; bot-authored messages do not trigger message rules
 - `allowed_mentions` default on send/edit/forum post/webhook; `everyone` rejected
 - purge preview equals execution when messages arrive in between
 - `members_list`/`mod_list_bans` cursors; resource read returns newest events with >100 events; `events_poll` with a type filter still returns gap markers
 - `/healthz` 503 when the gateway is down; stdio exits on stdin close; `database_path` resolves relative to the config dir; a second process on the same DB is refused
3. After the owners report done: run the whole gate, rewrite `docs/review-2026-09-29.md` honestly (round-2 defects with owner and commit, remaining known limitations), report to the lead. Never weaken an assertion to get green; report failures to the owner.
