-- Milestone 2: alert feed and community reactions.

ALTER TABLE incidents
  ADD COLUMN confirmations integer NOT NULL DEFAULT 0 CHECK (confirmations >= 0),
  ADD COLUMN over_votes    integer NOT NULL DEFAULT 0 CHECK (over_votes >= 0),
  ADD COLUMN false_votes   integer NOT NULL DEFAULT 0 CHECK (false_votes >= 0);

-- One row per public change worth telling people about. Rows become visible at visible_at,
-- which can be in the future when publication is delayed.
CREATE TABLE alert_events (
  id          bigserial PRIMARY KEY,
  incident_id uuid REFERENCES incidents (id),
  kind        text NOT NULL CHECK (kind IN ('new', 'upgraded', 'resolved', 'correction', 'broadcast')),
  tier        text NOT NULL CHECK (tier IN ('critical', 'warning', 'advisory')),
  category_id text,
  label       text,
  -- Public centre only (the H3 cell centre), never an exact location.
  lat         double precision NOT NULL,
  lng         double precision NOT NULL,
  tile        text NOT NULL,
  message     text,
  source      text,
  visible_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL
);

CREATE INDEX alert_events_feed_idx ON alert_events (tile, visible_at, id);
CREATE INDEX alert_events_incident_idx ON alert_events (incident_id, visible_at);

CREATE TABLE incident_reactions (
  incident_id uuid NOT NULL REFERENCES incidents (id),
  -- HMAC of (install id, incident id): one reaction per phone per incident, unlinkable across incidents.
  device_tag  bytea NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('confirm', 'over', 'false')),
  created_at  timestamptz NOT NULL,
  PRIMARY KEY (incident_id, device_tag)
);
