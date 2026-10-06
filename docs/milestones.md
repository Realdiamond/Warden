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

- [ ] The test APK is about 57 MB because it carries two phone architectures; split it per
      architecture (Play Store bundles do this automatically).
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

## M3 — Trips and SOS (contacts only)

- [ ] Trusted contacts with consent
- [ ] Trip sharing link, deviation and arrival checks
- [ ] SOS to trusted contacts with SMS fallback, duress PIN, 112 button

## M4 — Responders and channels

- [ ] Responder console: inbox, deployments with visibility levels, signed broadcasts
- [ ] USSD and SMS reporting pilot

## Blocked on the founder (not on code)

- [ ] Server and domain for a live backend
- [ ] Firebase project (push)
- [ ] Google Play developer account
- [ ] Company registration (CAC)
- [ ] SMS provider account and sender ID
- [ ] Privacy notice, consent text and DPIA with a lawyer
