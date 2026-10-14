-- Milestone 4: verified responder organisations, public updates, deployments, signed
-- broadcasts, the SOS board, and USSD reports.

CREATE TABLE organisations (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('police', 'emergency', 'health', 'fire', 'civil_defence', 'road_safety', 'community', 'other')),
  -- Where the organisation works. NULL means everywhere (a national agency).
  jurisdiction geometry(MultiPolygon, 4326),
  disabled_at  timestamptz,
  created_at   timestamptz NOT NULL
);

CREATE INDEX organisations_jurisdiction_gix ON organisations USING gist (jurisdiction);

ALTER TABLE staff DROP CONSTRAINT staff_role_check;
ALTER TABLE staff
  ADD CONSTRAINT staff_role_check CHECK (role IN ('moderator', 'admin', 'responder')),
  ADD COLUMN organisation_id uuid REFERENCES organisations (id),
  ADD CONSTRAINT staff_responder_org CHECK (role <> 'responder' OR organisation_id IS NOT NULL);

-- Public updates from responders ("on the way", "on scene").
CREATE TABLE incident_updates (
  id              bigserial PRIMARY KEY,
  incident_id     uuid NOT NULL REFERENCES incidents (id),
  organisation_id uuid NOT NULL REFERENCES organisations (id),
  staff_id        uuid NOT NULL REFERENCES staff (id),
  kind            text NOT NULL CHECK (kind IN ('acknowledged', 'responding', 'on_scene', 'resolved', 'note')),
  public_text     text,
  created_at      timestamptz NOT NULL
);

CREATE INDEX incident_updates_incident_idx ON incident_updates (incident_id, created_at);

CREATE TABLE deployments (
  id              uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations (id),
  staff_id        uuid NOT NULL REFERENCES staff (id),
  label           text NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('patrol', 'checkpoint', 'ambulance', 'fire_unit', 'rescue', 'other')),
  visibility      text NOT NULL CHECK (visibility IN ('public_street', 'public_area', 'responders', 'hidden')),
  -- Exact point for responders; the public sees only public_cell.
  location        geometry(Point, 4326) NOT NULL,
  public_cell     text NOT NULL,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  ended_at        timestamptz,
  created_at      timestamptz NOT NULL
);

CREATE INDEX deployments_location_gix ON deployments USING gist (location);
CREATE INDEX deployments_active_idx ON deployments (ends_at) WHERE ended_at IS NULL;

CREATE TABLE broadcasts (
  id              uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations (id),
  staff_id        uuid NOT NULL REFERENCES staff (id),
  tier            text NOT NULL CHECK (tier IN ('critical', 'warning', 'advisory')),
  message         text NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  radius_m        integer NOT NULL CHECK (radius_m BETWEEN 500 AND 50000),
  key_id          text NOT NULL,
  signature       bytea NOT NULL,
  expires_at      timestamptz NOT NULL,
  withdrawn_at    timestamptz,
  created_at      timestamptz NOT NULL
);

-- One alert row per tile a broadcast covers; they share the broadcast id.
ALTER TABLE alert_events ADD COLUMN broadcast_id uuid REFERENCES broadcasts (id);
CREATE INDEX alert_events_broadcast_idx ON alert_events (broadcast_id) WHERE broadcast_id IS NOT NULL;

-- SOS sessions the person chose to show to responders in the area.
ALTER TABLE safety_sessions ADD COLUMN share_with_responders boolean NOT NULL DEFAULT false;
-- Coarse last position (H3 resolution 7) so the SOS board can find sessions by area without
-- decrypting every session; the exact point stays encrypted.
ALTER TABLE safety_sessions ADD COLUMN last_area geometry(Point, 4326);
CREATE INDEX safety_sessions_area_gix ON safety_sessions USING gist (last_area)
  WHERE share_with_responders AND state <> 'ended';
