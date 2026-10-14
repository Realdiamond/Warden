-- Milestone 8: media on reports, SOS audio, spoken broadcasts, news leads.

-- Voice notes, photos and short videos attached to a report. Encrypted (base64 inside the
-- field cipher, so key rotation treats them like any other column) and deleted after 30 days.
CREATE TABLE report_media (
  id           uuid PRIMARY KEY,
  report_id    uuid NOT NULL REFERENCES reports (id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('audio', 'photo', 'video')),
  content_type text NOT NULL,
  bytes        integer NOT NULL,
  key_id       text NOT NULL,
  data_enc     bytea NOT NULL,
  created_at   timestamptz NOT NULL
);
CREATE INDEX report_media_report_idx ON report_media (report_id);
CREATE INDEX report_media_age_idx ON report_media (created_at);

-- Audio clips recorded during an SOS, for the person's trusted contacts. Deleted with the
-- session's other data.
CREATE TABLE session_audio (
  id           uuid PRIMARY KEY,
  session_id   uuid NOT NULL REFERENCES safety_sessions (id) ON DELETE CASCADE,
  content_type text NOT NULL,
  bytes        integer NOT NULL,
  key_id       text NOT NULL,
  data_enc     bytea NOT NULL,
  recorded_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL
);
CREATE INDEX session_audio_session_idx ON session_audio (session_id, recorded_at);

-- A spoken version of a broadcast. Public, like the text; its hash is part of the signature.
ALTER TABLE broadcasts ADD COLUMN audio_content_type text;
ALTER TABLE broadcasts ADD COLUMN audio_sha256 text;
ALTER TABLE broadcasts ADD COLUMN audio_data bytea;

-- Possible incidents found in news feeds. Never published by themselves: a moderator decides.
CREATE TABLE news_leads (
  id           uuid PRIMARY KEY,
  source       text NOT NULL,
  url          text NOT NULL UNIQUE,
  title        text NOT NULL,
  summary      text,
  published_at timestamptz,
  category_id  text,
  place        text,
  lat          double precision,
  lng          double precision,
  state        text NOT NULL DEFAULT 'new' CHECK (state IN ('new', 'added', 'dismissed')),
  incident_id  uuid REFERENCES incidents (id),
  decided_by   uuid REFERENCES staff (id),
  decided_at   timestamptz,
  created_at   timestamptz NOT NULL
);
CREATE INDEX news_leads_new_idx ON news_leads (created_at) WHERE state = 'new';
