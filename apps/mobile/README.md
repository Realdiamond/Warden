# @warden/mobile

Android app (Expo SDK 57, React Native 0.86) with MapLibre maps.

## What it does in milestone 1

- Live map of incidents as areas (never exact points), filtered to the last 6 hours, 24 hours or 7 days.
- Tap an area to see what was reported and how sure Warden is.
- Report in a few taps: type, place (where I am, or pick on the map), optional words. Anonymous.
- Reports are saved on the phone first and sent when online; retries never duplicate.
- "My reports" shows each report's status; the list can be cleared for shared-phone safety.
- 112 button on every reporting screen.
- Demo mode with built-in sample data when no server is set.

## Getting a test build

GitHub Actions builds an APK on every push that touches the app and publishes it as a pre-release on
the repository's Releases page. Each build has two APKs, one per phone processor family
(`app.config.ts` turns on Gradle's ABI splits): `warden-test-<n>.apk` for 64-bit phones (nearly
all phones from the last several years) and `warden-test-<n>-older-phones.apk` for 32-bit ones.

## For developers

```bash
pnpm typecheck && pnpm test          # logic tests run without a phone
pnpm bundle                          # Metro + Hermes bundle, catches import problems
pnpm prebuild && cd android && ./gradlew assembleRelease   # needs the Android SDK
```

`WARDEN_API_URL` (build time) bakes a server address into a build; otherwise testers can set one
in Settings. Demo data comes from `scripts/gen-demo.mts`.

`WARDEN_BROADCAST_PUBLIC_KEY` (build time) is the key the app uses to check responder broadcasts.
It is one bare key, or a list such as `s1:<key>,s2:<key>` while the server's signing key is being
changed (`docs/deploy.md`, "Changing keys").
