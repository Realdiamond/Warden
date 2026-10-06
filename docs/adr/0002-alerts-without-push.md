# 0002 — Alerts without a push service, matched on the phone

Status: accepted (M2)

## Context

The requirements call for alerts near a person's saved places (home, work, school). A push
service (Firebase Cloud Messaging) needs a Firebase project the founder does not have yet, and
push topics per H3 cell would tell Google and the Warden server which areas each phone follows.

## Decision

- The server writes one **alert event** per public change to an incident: new, upgraded
  (verified), resolved, correction, and later agency broadcasts. Events carry the public H3
  cell centre only, never an exact location, and are scheduled with the same random delay as the
  map. Private categories never produce events. A moderator acting before the delay ends
  withdraws the scheduled event.
- Phones ask `GET /v1/alerts?tiles=...&after=...` for coarse 0.1° tiles (about 11 km). Each
  place adds its tile and the eight around it. No install id is sent, and the server logs paths
  without query strings.
- The phone matches events to its places (3 km critical, 2 km warning, 1 km advisory), applies
  the person's tiers and quiet hours, and shows **local notifications**. "It's over" and
  corrections reach only people who were told about the incident.
- The open app checks every minute; when closed, Android's WorkManager runs a check roughly
  every 15 minutes, later when the phone is saving battery.

## Consequences

- Works today with no accounts, and the server never learns anyone's places.
- Closed-app alerts can be 15 minutes late or more. The app says so, and every screen keeps the
  112 button. When a Firebase project exists, a data-only "check now" push per tile can wake the
  phone sooner without changing the matching or the privacy model.
- Community reactions use an HMAC per phone and incident, unlinkable across incidents and to
  the phone's reports. Thresholds (two or three "over", three "false" that outnumber
  confirmations) never apply to critical incidents, which always need a moderator.
