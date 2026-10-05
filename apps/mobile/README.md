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
the repository's Releases page. Download it on an Android phone and install it.

## For developers

```bash
pnpm typecheck && pnpm test          # logic tests run without a phone
pnpm bundle                          # Metro + Hermes bundle, catches import problems
pnpm prebuild && cd android && ./gradlew assembleRelease   # needs the Android SDK
```

`WARDEN_API_URL` (build time) bakes a server address into a build; otherwise testers can set one
in Settings. Demo data comes from `scripts/gen-demo.mts`.
