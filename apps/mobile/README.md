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

## Look and feel (M10)

- Colours, the night palette and font names live in `src/lib/theme.ts`; a test checks every text
  colour is readable (4.5:1) in both themes. Screens build their styles with
  `useStyles((c) => StyleSheet.create(...))` so night mode applies everywhere.
- Use `Text` and `TextInput` from `src/components/text.tsx`, not React Native's: they pick the
  Atkinson Hyperlegible file for each weight. `fontFamily: MONO` gives the mono face for numbers.
- Shared pieces (buttons, cards, list rows, chips, switches, the 112 button) are in
  `src/components/ui.tsx`.
- Fonts are in `assets/fonts` (SIL Open Font License, `OFL.txt`), bundled by the `expo-font`
  plugin. Map marker icons are in `assets/map-icons`, rendered from the app's icon font; a new
  category icon needs a new image there (see ADR 0010) and a line in `src/components/mapIcons.ts`.
- `WARDEN_MAP_STYLE_URL` and `WARDEN_MAP_STYLE_DARK_URL` (build time) change the day and night maps.
- The first-run setup is `src/screens/Onboarding.tsx`; clearing the app's data shows it again.

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
