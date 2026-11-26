# Milestones

Progress log for Monitor. Newest first.

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
