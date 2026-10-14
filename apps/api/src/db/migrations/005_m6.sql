-- Milestone 6: off-route trips, trusted reporters and safe stops.

-- When the person left their route and did not answer "Are you OK?".
ALTER TABLE safety_sessions ADD COLUMN off_route_at timestamptz;

-- People Warden has checked (community leaders, journalists, partner staff) get a code for the
-- app. Their reports count as high trust. Only a hash of the code is kept; reports record that
-- they came from a trusted reporter, never which one.
CREATE TABLE trusted_reporters (
  id          uuid PRIMARY KEY,
  label       text NOT NULL,
  code_hash   bytea NOT NULL UNIQUE,
  created_by  text NOT NULL,
  created_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

ALTER TABLE reports ADD COLUMN trusted boolean NOT NULL DEFAULT false;

-- Public places to go when in danger: police stations, hospitals, fuel stations and so on.
-- These are public places, so their exact points are public too.
CREATE TABLE safe_stops (
  id          uuid PRIMARY KEY,
  kind        text NOT NULL CHECK (kind IN ('police', 'hospital', 'clinic', 'pharmacy', 'fuel', 'fire', 'other')),
  name        text NOT NULL,
  location    geometry(Point, 4326) NOT NULL,
  phone       text,
  open_24h    boolean NOT NULL DEFAULT false,
  source      text NOT NULL CHECK (source IN ('osm', 'partner', 'manual', 'demo')),
  source_ref  text,
  verified    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL,
  removed_at  timestamptz,
  UNIQUE (source, source_ref)
);

CREATE INDEX safe_stops_location_gix ON safe_stops USING gist (location) WHERE removed_at IS NULL;
