-- Milestone 9: fleet dashboards and the paid risk-data API.

-- Fleet operators (logistics, transport, ride-hailing) are organisations with their own console
-- accounts. They see only what the public map shows, gathered for the places they care about.
ALTER TABLE organisations DROP CONSTRAINT organisations_kind_check;
ALTER TABLE organisations
  ADD CONSTRAINT organisations_kind_check CHECK (kind IN ('police', 'emergency', 'health', 'fire', 'civil_defence', 'road_safety', 'community', 'other', 'fleet'));

ALTER TABLE staff DROP CONSTRAINT staff_role_check;
ALTER TABLE staff DROP CONSTRAINT staff_responder_org;
ALTER TABLE staff
  ADD CONSTRAINT staff_role_check CHECK (role IN ('moderator', 'admin', 'responder', 'fleet')),
  ADD CONSTRAINT staff_responder_org CHECK (role NOT IN ('responder', 'fleet') OR organisation_id IS NOT NULL);

-- Depots, yards, routes' busy points: a centre and a radius, owned by the fleet.
CREATE TABLE fleet_zones (
  id              uuid PRIMARY KEY,
  organisation_id uuid NOT NULL REFERENCES organisations (id),
  name            text NOT NULL,
  lat             double precision NOT NULL,
  lng             double precision NOT NULL,
  radius_m        integer NOT NULL CHECK (radius_m BETWEEN 500 AND 50000),
  created_by      uuid NOT NULL REFERENCES staff (id),
  created_at      timestamptz NOT NULL,
  deleted_at      timestamptz
);
CREATE INDEX fleet_zones_org_idx ON fleet_zones (organisation_id) WHERE deleted_at IS NULL;

-- Customers of the risk-data API. Only a keyed hash of each key is stored.
CREATE TABLE api_clients (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  key_hash     bytea NOT NULL UNIQUE,
  -- The first characters of the key, so a customer and Warden can tell keys apart.
  key_prefix   text NOT NULL,
  daily_quota  integer NOT NULL CHECK (daily_quota > 0),
  created_by   text NOT NULL,
  created_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

-- Requests per customer per day (Nigeria time), for quotas and invoices.
CREATE TABLE api_usage (
  client_id uuid NOT NULL REFERENCES api_clients (id),
  day       date NOT NULL,
  requests  integer NOT NULL DEFAULT 0,
  PRIMARY KEY (client_id, day)
);
