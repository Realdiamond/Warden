# Milestones

Progress log for Monitor. Newest first.

## Stage 1 — Backbone (in progress)

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
