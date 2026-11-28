-- D1 schema for the Andsv API. Apply with:
--   wrangler d1 execute monitor --file=./schema.sql            (local)
--   wrangler d1 execute monitor --remote --file=./schema.sql   (deployed)

CREATE TABLE IF NOT EXISTS accounts (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id                   TEXT PRIMARY KEY,
  account_id           TEXT NOT NULL REFERENCES accounts(id),
  name                 TEXT,
  platform             TEXT,
  app_version          TEXT,
  pair_code            TEXT,
  pair_code_expires_at TEXT,
  device_token_hash    TEXT,
  paired_at            TEXT,
  consent_accepted_at  TEXT,
  last_seen_at         TEXT,
  blocked_apps         TEXT,
  created_at           TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_account ON devices(account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_paircode
  ON devices(pair_code) WHERE pair_code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_token
  ON devices(device_token_hash) WHERE device_token_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS events (
  id          TEXT PRIMARY KEY,
  device_id   TEXT NOT NULL REFERENCES devices(id),
  kind        TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  payload     TEXT NOT NULL,
  encrypted   INTEGER NOT NULL,
  client_id   TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_device_kind_time
  ON events(device_id, kind, captured_at DESC);
-- Offline sync de-duplication: a re-sent event (same device + client_id) is ignored.
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_client
  ON events(device_id, client_id) WHERE client_id IS NOT NULL;

-- Watchlist: per-device names / numbers / keywords the parent collects.
CREATE TABLE IF NOT EXISTS watch_terms (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL REFERENCES devices(id),
  term       TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_watch_device ON watch_terms(device_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_watch_unique ON watch_terms(device_id, term);

CREATE TABLE IF NOT EXISTS commands (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL REFERENCES devices(id),
  type       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  done_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_commands_pending
  ON commands(device_id) WHERE done_at IS NULL;
