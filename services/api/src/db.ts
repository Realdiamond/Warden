import { DatabaseSync } from "node:sqlite";
import { config } from "./config.ts";

// Storage starts on SQLite (built into Node 22) so the backbone runs anywhere. All access goes
// through this module; moving to PostgreSQL at scale is a contained change.
export const db = new DatabaseSync(config.dbFile);

db.exec("PRAGMA foreign_keys = ON;");
if (config.dbFile !== ":memory:") {
  db.exec("PRAGMA journal_mode = WAL;");
}

db.exec(`
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
    encrypted   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_events_device_kind_time
    ON events(device_id, kind, captured_at DESC);
`);
