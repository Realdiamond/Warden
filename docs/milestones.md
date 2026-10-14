# Milestones

The full plan lives in the [Warden 2.0 Requirements Set](https://claude.ai/code/artifact/9e32d210-e4da-4bad-b899-a11b5ba06bcf).
This file tracks the build, one milestone at a time. Tick items as they land.

## M1 — Report to map (built; testing on real phones next)

- [x] Monorepo, tooling, decision records
- [x] Shared rules: categories, payload schemas, publication rules, H3 privacy levels
- [x] API: anonymous reports, merging, publication rules, map endpoint
- [x] API: staff login, moderation actions, hash-chained audit log, expiry job
- [x] Moderator console: queue, incident detail, verify / hold / remove / resolve
- [x] Android app: map, incident card, quick report, offline outbox, my reports, demo mode
- [x] CI: tests on every push; APK published as a GitHub pre-release

Known follow-ups from M1:

- [x] The test APK is about 57 MB because it carries two phone architectures; split it per
      architecture (done in M5).
- [ ] First tests on real low-end Android phones on MTN, Airtel and Glo.

## M2 — Alerts (built; see [ADR 0002](adr/0002-alerts-without-push.md))

- [x] Saved places kept on the phone (up to five, plus "where I last was")
- [x] Alert feed by coarse tiles; the phone matches its own places, so the server never learns them
- [x] Notifications by tier (danger, warning, advisory), quiet hours, flood control, test alert
- [x] All-clear ("it's over") and corrections sent only to people who were told
- [x] Spoken alerts in English while the app is open (Pidgin comes with the translation work)
- [x] Reactions: "Still happening", "It's over", "Looks false"; community thresholds, never for
      critical incidents
- [x] Background checks about every 15 minutes when the phone allows it
- [ ] Push delivery for faster alerts once a Firebase project exists (founder)

## M3 — Trips and SOS (built; see [ADR 0003](adr/0003-trips-and-sos.md))

- [x] Trusted contacts (up to five) kept on the phone; "Tell them" sends an invitation text from
      the person's own phone
- [x] Trip sharing: private live-location link, arrival time, overdue text to contacts, add time
- [x] SOS with a five-second countdown, texts to contacts, live location, 112 button
- [x] Safety PIN and duress PIN (looks like a normal stop, alarms contacts)
- [x] Live page for contacts at `/live#...`; the secret never reaches server logs
- [x] Stops and alarms are queued on the phone when there is no signal
- [x] Route deviation checks (M6)
- [ ] Text messages actually sent: needs the SMS provider account (founder)

## M4 — Responders and channels (built; see [ADR 0004](adr/0004-responders-and-ussd.md))

- [x] Verified organisations with an area (jurisdiction) and responder accounts
- [x] Responder console: incidents in their area (audited detail), public updates on the map,
      deployments with four visibility levels, signed broadcasts, SOS board
- [x] App: responder updates on incident cards, public deployments layer, broadcast signature
      check, "also alert responders" option for SOS
- [x] USSD reporting for Lagos and the FCT (held for a moderator, coarse area only)
- [ ] SMS reporting (needs the SMS provider's inbound number)
- [ ] Real organisation onboarding and boundaries (founder: partnerships, official maps)

## M5 — Ready for the pilot (built; see [ADR 0005](adr/0005-key-rotation.md))

- [x] Smaller test app: one APK per phone processor family instead of one for both
- [x] Field encryption key rotation: old keys kept for reading, `rotate-field-key` re-encrypts
- [x] Broadcast signing key rotation: phones trust several keys by id
- [x] Route deviation checks (built in M6; thresholds still need real-world tuning)
- [x] Pidgin (draft built in M6; other languages need translators)

## M6 — Safer trips and languages (built; see [ADR 0006](adr/0006-safer-trips-and-languages.md))

- [x] Off-route check on trips: the phone asks "Are you OK?", contacts are told only if there is
      no answer (PIN to answer, duress PIN raises the alarm quietly)
- [x] Trusted reporters: anonymous codes, their reports show sooner, revocable, audited
- [x] Safe places near you (police, hospitals, clinics, fuel, fire stations) on the trip screen,
      imported from OpenStreetMap or partner files
- [x] Pidgin (draft) for alerts, spoken alerts, SOS, trips, safe places and private-report help
- [x] Help after a private report: 112 and confirmed support services only
- [ ] Pidgin checked by a native speaker (founder)
- [ ] Real support services and phone numbers confirmed with each organisation (founder)
- [ ] Safe places imported for Lagos and Abuja on the live server, and spot checked
- [ ] Off-route thresholds tuned after real trips in Lagos traffic

## M7 — Community feed and route score (built; see [ADR 0007](adr/0007-community-feed-and-route-score.md))

- [x] Community feed in the app: checked tips, Warden team notices and live broadcasts for the
      area, with "Report this" on tips and notices
- [x] Anonymous tips, read by a moderator first (Community page in the console), area only
- [x] Three reports hide a post until a moderator looks again
- [x] Route safety score on the trip screen, worked out on the phone
- [ ] Moderator rota for tips before launch (founder)

## M8 — Media, voice and insights (built; see [ADR 0008](adr/0008-media-voice-and-insights.md))

- [x] Voice notes, photos and short videos with reports, sent after the report, staff only,
      encrypted, deleted after 30 days, photo GPS details removed
- [x] Opening a file in the console is written to the audit log
- [x] Sound recorded during an SOS (opt-in in Safety settings), playable by contacts on their link
- [x] Spoken broadcasts recorded in the console, signed, checked on the phone before playing
- [x] Area outlook in the app (counts from the last 3 months, not a prediction)
- [x] News page in the console: headlines from chosen RSS feeds, added to the map only by a
      moderator
- [ ] News outlets chosen and their feed terms checked (founder)
- [ ] SOS sound tried on a few Android phones with the screen off (founder)
- [ ] Lawyer's view on SOS sound recording and on keeping report media for 30 days (founder)

## M9 — Fleet dashboard and risk-data API (built; see [ADR 0009](adr/0009-fleet-and-data-api.md))

- [x] Fleet accounts in the console: watched places, public incidents around each in the last 24
      hours, the area outlook and a route check; no access to moderation or responder screens
- [x] Risk-data API with keys, daily quotas, per-day usage for invoices, and area counts that
      leave out small numbers ([API guide](data-api.md))
- [ ] Prices, contracts and terms of use for fleets and data customers (founder, with a lawyer)
- [ ] First fleet and data customers onboarded (founder)

## Blocked on the founder (not on code)

- [ ] Server and domain for a live backend
- [ ] Firebase project (faster push alerts; the app works without it)
- [ ] USSD short code (Africa's Talking or similar)
- [ ] Partner agreements with responder organisations
- [ ] Google Play developer account
- [ ] Company registration (CAC)
- [ ] SMS provider account and sender ID
- [ ] Privacy notice, consent text and DPIA with a lawyer
