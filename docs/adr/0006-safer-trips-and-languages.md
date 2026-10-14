# 0006 — Off-route checks, trusted reporters, safe places, Pidgin and support referrals

Status: accepted (M6)

## Context

M6 adds five features from the v1 product documents. Each touched a privacy rule, so each was
adapted rather than copied.

## Decision

- **Off-route checks run on the phone.** The phone already has every position, so it compares
  them with the trip's destination (`packages/shared/src/route.ts`). It is cautious because GPS
  on cheap phones is noisy and people take detours: positions worse than 100 m are ignored, the
  person must be more than 1.5 km (or a quarter of the trip) further away than their closest
  point, for four minutes. Then the phone asks "Are you OK?" with a loud notification. Only if
  nobody answers within five minutes does the phone call `POST /v1/sessions/:id/flag` with
  `off_route`, which texts contacts once and shows the alarm on the live page. Answering later
  sends `ok`, which clears the alarm and tells contacts the person is OK. Reaching the
  destination settles an unanswered question. Flags sent without signal are kept and retried. Answering needs
  the Warden PIN; the duress PIN looks the same but flags `duress`. The v1 idea of the server
  tracking routes against a road network was dropped: it needs a routing service, and the server
  would have to reason about people's movements.
- **Limitation.** The overdue check runs on each location update, every 15 minutes in the
  background and every 30 seconds while the app is open. If the phone dies, the existing
  "late arrival" text still covers the person.
- **Trusted reporters are anonymous to everyone, including Warden's moderators.** Warden gives a
  checked person (a CDA chair, a journalist) a 20-character code. The server stores only a keyed
  hash of it. Reports sent with a valid code are marked `trusted` (a yes/no only, never which
  reporter) and count as high trust, so a single report publishes as "Unconfirmed" without
  waiting for a second one. Creating and revoking codes is audited. Revoked or made-up codes are
  refused, so a leaked code can be switched off.
- **Safe places come from open data, not from users.** Police stations, hospitals, clinics,
  pharmacies, fuel and fire stations are imported from OpenStreetMap or partner GeoJSON files
  with `import-safe-stops`, and served by area at `GET /v1/safe-stops`. Imported places show
  "Not yet checked by Warden" until imported again with `--verified`. The phone does not send its
  exact position: it asks for a box of about 10 km around it and works out the nearest places
  itself. The server sees only that rough area, as it does for the map.
- **Pidgin is a draft.** The phrases that matter most in danger (alerts, spoken alerts, SOS,
  trips, the "Are you OK?" check, safe places, private-report help) have a Pidgin version
  (`apps/mobile/src/lib/i18n.ts`). It was written without a native speaker and is labelled
  "Pidgin (draft)" in Settings until one has checked it. Spoken alerts use the Nigerian English
  voice, since phones have no Pidgin voice. Hausa, Yoruba and Igbo wait for translators.
- **Support referrals show nothing unconfirmed.** After a private report (sexual or domestic
  violence, missing person) the app explains that the report stays off the map, offers 112, and
  lists support services for that category. The list (`packages/shared/src/support.ts`) holds
  placeholders marked `verified: false`; only entries the founder has confirmed with the
  organisation, with a phone number, are ever shown. A wrong number given to a survivor is worse
  than none.

## Consequences

- A trip with no destination has no off-route check; the late-arrival text still applies.
- Trusted reporter codes are bearer secrets: anyone holding one is trusted until it is revoked.
  The limit for code holders is 30 reports an hour.
- Safe places are only as good as the imported data, so the founder should import and spot
  check one city before launch.
