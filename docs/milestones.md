# Milestones

Progress log for Monitor. Newest first.

## Deployment — live on Cloudflare (done)

- **Live URL:** https://monitor-api.homegoing.workers.dev (dashboard + API on one origin).
- API ported to a Cloudflare Worker + D1 (`workers/api`): Web Crypto (AES-256-GCM + PBKDF2),
  jose JWT, Hono router. Same endpoints/behaviour as the Node version; verified locally
  (Miniflare + local D1) and live.
- The dashboard is bundled into the Worker script (`scripts/bundle-dashboard.mjs`) and served
  from the same origin — avoids a separate asset upload.
- D1 database `monitor` created; schema applied; Worker secrets `MONITOR_JWT_SECRET` and
  `MONITOR_ENCRYPTION_KEY` set via `wrangler secret`.
- Both Android apps default to the live API URL.
- Verified live: a real browser signs up, pairs a device, and sees location + usage + calls +
  messages on the dashboard served from Cloudflare.
- Note: the Node API in `services/api` stays for local dev and the test suite.

## Stage 4 — Call history (done)

- Monitored app: `CallLogReporter` reports new call-log entries (number, direction, duration)
  every ~15 min; requests READ_CALL_LOG; tracks last-reported time to avoid duplicates.
- API: `call` is a sensitive kind — encrypted at rest (round-trip test added; 7 tests pass).
- Dashboard: device page shows a "Calls" section (direction badge, number, duration, time).
- Permanent notice + consent text updated to disclose location, apps, messages, calls and screen.
- Scope note: call *history* only — call audio/recording is not available to a normal app on
  modern Android.

## Stage 3b — On-screen chat reader (built, needs device testing)

- Monitored app: `ChatReaderService` (AccessibilityService) reads messages from the screen in
  WhatsApp/Telegram/Messenger as chats are opened/scrolled; reports them as `message` events with
  source "chat" (notification-captured ones are source "notification").
- Deduped via a bounded LRU so the same visible messages aren't re-sent on every scroll.
- Pairing screen links to Accessibility settings to grant it.
- Dashboard tags on-screen-captured messages with an "on-screen" badge.
- Honest limits: only what is opened on screen (not archived/unopened chats, not the stored DB);
  depends on each app's on-screen layout (view ids), so it needs testing + tuning on a real phone.
- Builds cleanly; behaviour must be verified on-device.

## Stage 3 — Messages (done)

- Monitored app: `MessageListener` (NotificationListenerService) captures incoming message
  notifications (sender + text) from common messaging apps (WhatsApp, Telegram, Messenger, SMS,
  Instagram, Snapchat, Discord, Viber). Pairing screen links to Notification Access settings.
- API: `message` events are a sensitive kind — encrypted at rest; decrypted only for the parent.
- Dashboard: device page shows a "Messages" section (sender · app · time · text).
- Verified: message round-trips through encryption (API test), message text is absent from the
  DB file in plaintext, child APK builds, dashboard screenshot shows messages.
- Scope note: captures incoming notifications, not full chat history or outgoing messages.

## Stage 2 — App usage (done)

- Monitored app: reports per-app foreground time via UsageStatsManager every ~15 min; pairing
  screen links to the "Usage access" settings so the user can grant it.
- API: `app_usage` events stored and read back (test added).
- Dashboard: device page shows "App usage (today)" — latest total per app, longest first.
- Verified: API tests green, dashboard build + browser screenshot showing usage, child APK builds.

## Stage 1 — Backbone (done)

**Done (parent Android app)**
- `android/parent`: native Kotlin app for the parent — sign in, device list, device location +
  history, open a point in a maps app. Mirrors the web dashboard on the phone.
- Verified: builds a real `app-debug.apk` here; GitHub Actions builds it on every push
  (`.github/workflows/android-parent.yml`).

**Done (monitored Android app)**
- `android/child`: native Kotlin app for the monitored phone.
  - Pairing screen: explains the app openly, takes the code, requires an explicit consent tick.
  - Foreground service with a permanent "Monitoring is on" notice (cannot be swiped away).
  - Reports location (~60s) via FusedLocationProvider; requests foreground then background
    location; restarts after reboot.
  - Verified: builds a real `app-debug.apk` (compiled + packaged with Android SDK 34 here);
    GitHub Actions also builds the APK on every push (`.github/workflows/android-child.yml`).
  - Follow-ups: move device token to EncryptedSharedPreferences; tune location cadence.

**Done (dashboard)**
- `web/dashboard`: parent web app (React + Vite + Leaflet).
  - Sign up / sign in, device list, add device → pairing code shown.
  - Device page: latest location + history, plotted on an OpenStreetMap map with a trail.
  - "Paired" / "Consent recorded" / "Last seen" status badges.
  - The API now serves the built dashboard from the same origin (plus CORS for dev).
  - Verified by an automated browser (Playwright) test: sign up → add device → simulated
    phone pairs with consent and reports a track → dashboard shows it on the map.

**Done (API)**
- Monorepo scaffold: pnpm workspace, shared package, API service.
- `packages/shared`: event kinds, sensitivity classification, pairing/DTO contracts.
- `services/api`: Node 22 + TypeScript (run directly, no build step), SQLite storage.
  - Accounts: sign up, log in (scrypt password hashing, JWT sessions).
  - Devices: parent creates a device + pair code; lists and reads its own devices.
  - Pairing: child app redeems a pair code **with recorded consent** → device token.
  - Consent gate: event ingestion rejected unless the device recorded consent.
  - Events: child posts `location`; parent reads latest + history. Sensitive payloads encrypted
    at rest (AES-256-GCM).
  - End-to-end test covering the whole flow.

**Next**
- `web/dashboard`: parent signs in, sees a device's location on a map + history.
- `android/child`: consent screen, permanent notice, pairing, location reporting.
- `android/parent`: same views as the dashboard, native.
