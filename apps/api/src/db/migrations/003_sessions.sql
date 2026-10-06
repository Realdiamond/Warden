-- Milestone 3: trip sharing and SOS to trusted contacts.

CREATE TABLE safety_sessions (
  id                  uuid PRIMARY KEY,
  kind                text NOT NULL CHECK (kind IN ('trip', 'sos')),
  state               text NOT NULL CHECK (state IN ('active', 'overdue', 'ended')),
  duress              boolean NOT NULL DEFAULT false,
  outcome             text CHECK (outcome IN ('arrived', 'safe', 'cancelled', 'expired')),
  -- Only hashes of the tokens, plus the view token encrypted so the server can put the link in
  -- an SMS when a trip is overdue and the phone may be off.
  view_token_hash     bytea NOT NULL,
  control_token_hash  bytea NOT NULL,
  key_id              text NOT NULL,
  view_token_enc      bytea NOT NULL,
  -- Name, note, destination and contacts, encrypted together.
  details_enc         bytea NOT NULL,
  expected_arrival_at timestamptz,
  last_point_at       timestamptz,
  started_at          timestamptz NOT NULL,
  ended_at            timestamptz,
  expires_at          timestamptz NOT NULL,
  updated_at          timestamptz NOT NULL
);

CREATE INDEX safety_sessions_open_idx ON safety_sessions (state, expected_arrival_at)
  WHERE state <> 'ended';
CREATE INDEX safety_sessions_ended_idx ON safety_sessions (ended_at) WHERE state = 'ended';

CREATE TABLE session_points (
  id          bigserial PRIMARY KEY,
  session_id  uuid NOT NULL REFERENCES safety_sessions (id) ON DELETE CASCADE,
  recorded_at timestamptz NOT NULL,
  key_id      text NOT NULL,
  point_enc   bytea NOT NULL,
  created_at  timestamptz NOT NULL
);

CREATE INDEX session_points_session_idx ON session_points (session_id, recorded_at);

-- Text messages to trusted contacts, sent by a worker with retries.
CREATE TABLE sms_outbox (
  id              bigserial PRIMARY KEY,
  session_id      uuid REFERENCES safety_sessions (id) ON DELETE CASCADE,
  event           text NOT NULL,
  -- HMAC of the number, to cap messages per number per day without storing it in clear.
  to_hash         bytea NOT NULL,
  key_id          text NOT NULL,
  message_enc     bytea NOT NULL,
  attempts        integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL,
  sent_at         timestamptz,
  failed_at       timestamptz,
  created_at      timestamptz NOT NULL
);

CREATE INDEX sms_outbox_due_idx ON sms_outbox (next_attempt_at)
  WHERE sent_at IS NULL AND failed_at IS NULL;
CREATE INDEX sms_outbox_recipient_idx ON sms_outbox (to_hash, created_at);
