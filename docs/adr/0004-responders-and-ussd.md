# 0004 — Responders, signed broadcasts and USSD

Status: accepted (M4)

## Context

Responders (police, emergency services, road safety, community groups) need to see incidents in
their area, tell the public what they are doing, and send warnings. People without data need a
way to report. Each of these widens who can see or publish information, so each needs a limit.

## Decision

- **Organisations** are created by a Warden administrator from the command line after checking
  they are genuine. Each has a jurisdiction (a PostGIS polygon, or none for a national body).
  Responder accounts belong to one organisation and use the same console sign-in as moderators,
  but only their own screens; neither role can open the other's.
- **Incidents for responders**: public-category incidents that are live on the map, plus
  critical ones still held for review (marked "not yet checked"), inside the jurisdiction, from
  the last 24 hours. Private categories never reach responders through Warden. Opening a detail
  with exact locations writes an audit entry, as for moderators.
- **Public updates** ("on the way", "on scene", a short note) show on the incident card; a
  responder closing an incident resolves it and sends the "it's over" alert.
- **Deployments** have four visibility levels. Even public ones are shown only as H3 areas (about
  0.1 km² or 5 km²), never as points, so the public map never carries exact coordinates.
- **Broadcasts** are signed by the server with Ed25519 over a fixed text (id, sender, level,
  centre, radius, expiry, message). Phones carry the public key from their build and drop any
  broadcast whose signature fails; test builds without a key mark broadcasts "not verified".
  A broadcast is written once per alert tile it covers, and phones show it once.
- **SOS board**: an SOS appears to responders only when the person turned on "also alert
  responders near me". The board filters by a coarse area (H3 resolution 7) so exact points stay
  encrypted until a responder in that area opens the board, which is audited.
- **USSD** follows the Africa's Talking callback format and works out the menu from the text
  typed so far, keeping no session state. Reports are placed at the local government area's
  approximate centre, always held for a moderator and, if published, shown only at resolution 7.
  The caller's number is used only as a keyed hash for rate limiting; the callback address
  carries a secret that is removed from logs.

## Consequences

- Onboarding real organisations, their official boundaries and the USSD short code are founder
  tasks. The built-in Lagos and FCT boxes and area centres are approximate.
- A compromised server signing key could sign false broadcasts; rotating it needs a new app build.
  Key rotation with more than one trusted key is a follow-up.
