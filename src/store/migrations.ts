export interface Migration {
  version: number
  sql: string
}

export const migrations: Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  tier TEXT NOT NULL,
  guild_id TEXT,
  actor TEXT NOT NULL,
  actor_user_id TEXT,
  input_hash TEXT NOT NULL,
  outcome TEXT NOT NULL,
  error_code TEXT,
  latency_ms INTEGER NOT NULL
);
CREATE INDEX audit_guild ON audit (guild_id, id);
CREATE INDEX audit_tool ON audit (tool, id);
CREATE INDEX audit_actor ON audit (actor_user_id, id);

CREATE TABLE confirmations (
  token_hash TEXT PRIMARY KEY,
  input_hash TEXT NOT NULL,
  principal_key TEXT NOT NULL,
  tool TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  guild_id TEXT NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX events_guild ON events (guild_id, id);

CREATE TABLE rules (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  owner_user_id TEXT,
  created_at TEXT NOT NULL,
  disabled_reason TEXT,
  enabled INTEGER NOT NULL,
  trigger_event TEXT NOT NULL,
  trigger_filter TEXT NOT NULL,
  conditions TEXT NOT NULL,
  actions TEXT NOT NULL,
  cooldown_sec INTEGER NOT NULL,
  allow_destructive INTEGER NOT NULL,
  cooldown_until INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX rules_guild_event ON rules (guild_id, trigger_event);

CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret_hash TEXT,
  redirect_uris TEXT NOT NULL,
  client_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_states (
  state TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  client_state TEXT,
  scopes TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  guilds TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE oauth_sessions (
  family_id TEXT PRIMARY KEY,
  access_hash TEXT NOT NULL UNIQUE,
  refresh_hash TEXT NOT NULL UNIQUE,
  client_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT NOT NULL,
  guilds TEXT NOT NULL,
  access_expires_at INTEGER NOT NULL,
  refresh_expires_at INTEGER NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX oauth_sessions_user ON oauth_sessions (user_id);

CREATE TABLE oauth_refresh_history (
  refresh_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL
);
`,
  },
  {
    version: 2,
    sql: `
CREATE INDEX oauth_sessions_refresh_expiry ON oauth_sessions (refresh_expires_at);
CREATE TABLE oauth_code_families (
  code_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL
);
CREATE INDEX oauth_code_families_family ON oauth_code_families (family_id);
`,
  },
]
