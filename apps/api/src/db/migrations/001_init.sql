-- Milestone 1 schema: incidents, reports, staff, sessions, audit log, idempotency.
-- Exact locations and report text are stored only as ciphertext (see src/crypto.ts).

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE incidents (
  id                  uuid PRIMARY KEY,
  category_id         text NOT NULL,
  severity            text NOT NULL CHECK (severity IN ('critical', 'high', 'standard')),
  handling            text NOT NULL CHECK (handling IN ('public', 'private')),
  state               text NOT NULL CHECK (state IN ('held', 'unconfirmed', 'verified', 'disputed', 'resolved', 'removed', 'merged')),
  merged_into         uuid REFERENCES incidents (id),
  -- Public precision: H3 resolution 8 for critical incidents, 9 otherwise.
  public_cell         text NOT NULL,
  public_point        geometry(Point, 4326) NOT NULL,
  -- Resolution-9 cell of the first report; used only to merge nearby reports.
  match_cell          text NOT NULL,
  report_count        integer NOT NULL DEFAULT 0 CHECK (report_count >= 0),
  independent_reports integer NOT NULL DEFAULT 0 CHECK (independent_reports >= 0),
  first_reported_at   timestamptz NOT NULL,
  last_report_at      timestamptz NOT NULL,
  -- NULL means not scheduled for publication.
  publish_after       timestamptz,
  active_until        timestamptz NOT NULL,
  verified_at         timestamptz,
  resolved_at         timestamptz,
  source              text NOT NULL DEFAULT 'citizen' CHECK (source IN ('citizen', 'agency', 'news', 'partner', 'demo')),
  source_ref          text,
  created_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL
);

CREATE INDEX incidents_public_point_gix ON incidents USING gist (public_point);
CREATE INDEX incidents_queue_idx ON incidents (state, severity, first_reported_at);
CREATE INDEX incidents_merge_idx ON incidents (category_id, match_cell, last_report_at)
  WHERE state IN ('held', 'unconfirmed', 'verified', 'disputed');
CREATE INDEX incidents_expiry_idx ON incidents (active_until)
  WHERE state IN ('unconfirmed', 'verified', 'disputed');

CREATE TABLE reports (
  id                uuid PRIMARY KEY,
  incident_id       uuid NOT NULL REFERENCES incidents (id),
  channel           text NOT NULL CHECK (channel IN ('app', 'lite', 'ussd', 'sms', 'voice', 'whatsapp', 'demo')),
  category_id       text NOT NULL,
  key_id            text NOT NULL,
  location_enc      bytea NOT NULL,
  description_enc   bytea,
  cell_r7           text NOT NULL,
  cell_r8           text NOT NULL,
  cell_r9           text NOT NULL,
  proximity         text NOT NULL CHECK (proximity IN ('here', 'near', 'far', 'unknown')),
  -- HMAC of (install id, incident id): spots repeat reports from one phone on one incident
  -- without linking a phone's reports across incidents.
  device_tag        bytea,
  status_token_hash bytea NOT NULL,
  occurred_at       timestamptz,
  received_at       timestamptz NOT NULL
);

CREATE INDEX reports_incident_idx ON reports (incident_id);
CREATE INDEX reports_device_tag_idx ON reports (incident_id, device_tag);

CREATE TABLE idempotency_keys (
  key_hash     bytea PRIMARY KEY,
  key_id       text NOT NULL,
  response_enc bytea NOT NULL,
  created_at   timestamptz NOT NULL
);

CREATE INDEX idempotency_keys_created_idx ON idempotency_keys (created_at);

CREATE TABLE staff (
  id            uuid PRIMARY KEY,
  email         text NOT NULL,
  password_hash text NOT NULL,
  role          text NOT NULL CHECK (role IN ('moderator', 'admin')),
  disabled_at   timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz NOT NULL
);

CREATE UNIQUE INDEX staff_email_idx ON staff (lower(email));

CREATE TABLE staff_sessions (
  token_hash   bytea PRIMARY KEY,
  staff_id     uuid NOT NULL REFERENCES staff (id),
  created_at   timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at   timestamptz NOT NULL
);

CREATE INDEX staff_sessions_staff_idx ON staff_sessions (staff_id);

CREATE TABLE audit_events (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL,
  actor_type  text NOT NULL CHECK (actor_type IN ('staff', 'system')),
  actor_id    text NOT NULL,
  action      text NOT NULL,
  object_type text NOT NULL,
  object_id   text NOT NULL,
  reason      text,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  prev_hash   bytea,
  hash        bytea NOT NULL
);

CREATE INDEX audit_events_object_idx ON audit_events (object_type, object_id, id);

-- The audit log is append-only.
CREATE FUNCTION audit_events_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$;

CREATE TRIGGER audit_events_no_update_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION audit_events_append_only();

CREATE TRIGGER audit_events_no_truncate
  BEFORE TRUNCATE ON audit_events
  FOR EACH STATEMENT EXECUTE FUNCTION audit_events_append_only();
