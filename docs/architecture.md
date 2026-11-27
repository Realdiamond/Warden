# Andsv — architecture & roadmap

## What it is

A consent-based monitoring system for a monitored Android phone, watched and managed by a parent
through a web dashboard and a parent Android app. Built in stages; every stage works end to end on
a real phone before the next is added.

## Non-negotiable rules (the "overtness" contract)

These are to Andsv what the encryption rules are to a safety app: break one and the product is
no longer the product.

1. **Overt only.** The monitored phone always shows a permanent notice + the app's own icon. No
   hidden or disguised mode is ever built.
2. **Consent is recorded and enforced.** A device is not activated until it has posted a
   `consent_accepted_at`. The API rejects event ingestion from a device with no recorded consent.
3. **Live actions are signalled.** Live screen view and remote control raise an on-device
   indicator for the duration.
4. **Sensitive data is encrypted at rest.** Message/call contents and exact coordinates are
   encrypted with AES-256-GCM (`services/api/src/crypto.ts`) before they touch storage.
5. **Parameterised queries only.** No string-built SQL.
6. **Two identities, never mixed.** A *parent account* authenticates with a login + JWT. A
   *monitored device* authenticates with a device token issued at pairing. A device token can only
   write its own events; a parent token can only read devices on its own account.

## Shape

```
 monitored phone (android/child)                parent (web/dashboard + android/parent)
   collects events  ──POST /v1/events──►  services/api  ◄──GET /v1/devices/:id/events── views
   enforces notice & consent                   │
   serves live view / control  ◄── realtime relay (later) ──►  live viewer / controller
```

### Identities & auth

- **Account**: `POST /v1/accounts` (sign up), `POST /v1/sessions` (log in) → JWT bearer.
- **Device**: parent calls `POST /v1/devices` → gets a short-lived **pair code**. The child app
  calls `POST /v1/pairing` with the code + recorded consent → gets a long-lived **device token**.
- The child app sends events with `Authorization: Bearer <device token>`.
- The parent reads with `Authorization: Bearer <account JWT>`.

### Events

Every signal from the phone is an `event`: `{ device_id, kind, captured_at, payload }`. `kind` is
one of `location | app_usage | message | call | screen | control | ...`. Payloads for sensitive
kinds are encrypted at rest. `packages/shared` owns the kind list and which kinds are sensitive.

### Storage

Starts on **SQLite** (`node:sqlite`, built into Node 22 — zero external dependencies) so the
backbone runs anywhere, including a pilot server. The data access is isolated in
`services/api/src/db.ts`; moving to PostgreSQL at scale is a contained change. SQLite files are
git-ignored.

## Roadmap (approach: backbone first, then features by value)

- [x] **Stage 0 — Scaffold.** Workspace, shared package, API skeleton.
- [x] **Stage 1 — Backbone.** Accounts, pairing, consent gate, **location** end to end across
      all four pieces: API, web dashboard, monitored app, parent app. Both Android apps build to
      real APKs (locally and in CI).
- [x] **Stage 2 — App usage.** Monitored app reports per-app foreground time (UsageStats);
      dashboard shows the latest totals per app. Needs the "Usage access" permission (the pairing
      screen links to it).
- [x] **Stage 3 — Messages.** Monitored app captures incoming message notifications (sender +
      text) from common messaging apps via a NotificationListenerService; encrypted at rest;
      shown on the dashboard. (Captures incoming notifications, not full chat history or outgoing
      messages — the realistic on-device technique.)
- [ ] **Stage 4 — Calls.** History + contents.
- [ ] **Stage 5 — Limits.** Block apps, screen-time rules.
- [ ] **Stage 6 — Live screen view.** Real-time relay + on-device indicator.
- [ ] **Stage 7 — Remote control.** Act on the phone; on-device indicator.
- [ ] **Stage 8 — Remote unlock.** Needs a feasibility check first — modern Android restricts this
      heavily (likely requires device-owner enrolment). Confirm before promising it.

## Feature feasibility (honest reference for client conversations)

| Feature | Reality |
| --- | --- |
| Location (now + history) | Done. |
| App usage (which apps, how long) | Done. |
| Messages (incoming notifications: sender + text) | Done. Captures incoming message notifications, not full chat history or outgoing messages. |
| Call history (who, when, how long) | Doable — building now. |
| Call audio / listening to calls | **Not possible** for a normal app on modern Android — Google removed call-recording access in Android 10+. Do not promise this to the client. |
| App limits / blocking | Doable; needs testing on a real phone. |
| Live screen view | Doable via screen capture (MediaProjection) + a relay carried by our backend. One approval on Android 9 (reused); the permanent "monitored" notice discloses it. Needs a phone to test. |
| Remote control | Partly doable (tap/type via an Accessibility service); "control it like Zoom" is approximate and device-dependent. Needs heavy on-phone testing. |
| Remote unlock | Hardest. A normal app can't type the PIN. The only real route is enrolling the phone as a company-managed (device-owner) device, set up on a fresh/reset phone — which changes onboarding. Must be tested on a real device before promising it. |

## Open technical risks (to confirm by spike, not assume)

- **Messages/calls across third-party apps** rely on Android's AccessibilityService and
  Notification access; fragile across app updates and checked closely by Android.
- **Live screen + remote control** need MediaProjection + AccessibilityService and a low-latency
  relay.
- **Remote unlock** likely needs the phone enrolled as a managed/device-owner device — a specific
  onboarding step, possibly on a factory-reset phone. This changes setup, so it is confirmed before
  it is designed around.
