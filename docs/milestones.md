# Milestones

The full plan lives in the [Warden 2.0 Requirements Set](https://claude.ai/code/artifact/9e32d210-e4da-4bad-b899-a11b5ba06bcf).
This file tracks the build, one milestone at a time. Tick items as they land.

## M1 — Report to map (in progress)

- [x] Monorepo, tooling, decision records
- [ ] Shared rules: categories, payload schemas, publication rules, H3 privacy levels
- [ ] API: anonymous reports, merging, publication rules, map endpoint
- [ ] API: staff login, moderation actions, hash-chained audit log, expiry job
- [ ] Moderator console: queue, incident detail, verify / hold / remove / resolve
- [ ] Android app: map, incident card, quick report, offline outbox, my reports, demo mode
- [ ] CI: tests on every push; APK published as a GitHub pre-release

## M2 — Alerts

- [ ] Saved places kept on the phone; area alerts via push topics per H3 cell
- [ ] Spoken alerts (English, Pidgin), quiet hours, all-clear and corrections
- [ ] Reactions: "I can see this", "It's over"

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
