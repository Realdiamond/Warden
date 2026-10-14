-- Milestone 7: community feed.

-- Anonymous tips (read by a moderator first) and notices from the Warden team. A post keeps
-- only its coarse H3 area (resolution 7), never a point. Text is encrypted at rest like report
-- text, even once published, so a copy of the database does not hold readable tips.
CREATE TABLE community_posts (
  id           uuid PRIMARY KEY,
  kind         text NOT NULL CHECK (kind IN ('tip', 'notice')),
  state        text NOT NULL CHECK (state IN ('pending', 'published', 'rejected', 'removed')),
  cell         text NOT NULL,
  -- The centre of the cell (not where the tip was sent from), for finding posts by map area.
  center_lat   double precision NOT NULL,
  center_lng   double precision NOT NULL,
  area_label   text,
  body_enc     bytea NOT NULL,
  key_id       text NOT NULL,
  created_by   uuid REFERENCES staff (id),
  created_at   timestamptz NOT NULL,
  published_at timestamptz,
  expires_at   timestamptz NOT NULL,
  decided_by   uuid REFERENCES staff (id),
  decided_at   timestamptz,
  flags        integer NOT NULL DEFAULT 0
);
CREATE INDEX community_posts_area_idx ON community_posts (center_lat, center_lng) WHERE state = 'published';
CREATE INDEX community_posts_pending_idx ON community_posts (created_at) WHERE state = 'pending';

-- One flag per phone per post; the phone is a keyed hash that cannot be linked to anything else.
CREATE TABLE community_post_flags (
  post_id    uuid NOT NULL REFERENCES community_posts (id),
  device_tag bytea NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (post_id, device_tag)
);
