# Andsv — monitored Android app

This is the app installed **on the monitored phone** (for example, a child's phone). It is open
about what it does: a consent screen at setup and a permanent "Monitoring is on" notice while it
runs.

## What it does today (Stage 1)

- A pairing screen that explains the app, takes the 8-digit pairing code, and requires an explicit
  consent tick before it will pair.
- A foreground service that keeps a permanent notice in the status bar and reports the phone's
  **location** to the API roughly once a minute.
- Restarts monitoring after a reboot (once paired).

Later stages add app usage, messages, calls, limits, live screen and remote control.

## Build it

**Easiest — download the built APK:** every push to the `andsv` branch builds a debug APK in
GitHub Actions (see `.github/workflows/android-child.yml`). Open the workflow run and download the
`andsv-child-debug-apk` artifact.

**In Android Studio:** open the `android/child` folder, let it sync, then Run.

**Command line** (needs the Android SDK and JDK 17+):

```bash
cd android/child
gradle assembleDebug          # or ./gradlew assembleDebug once the wrapper is generated
# output: app/build/outputs/apk/debug/app-debug.apk
```

## Install on a phone

1. On the phone, allow installing from unknown sources (the app is distributed outside the Play
   Store on purpose).
2. Copy `app-debug.apk` to the phone and open it to install.
3. Open **Andsv**, set the **Server address** to your deployed API, enter the pairing code from
   the dashboard, tick consent, and pair.
4. Grant location and notification permissions when asked.

## Settings

- `Store.DEFAULT_BASE_URL` in `app/src/main/java/com/andsv/child/Store.kt` is the default API
  address shown on the pairing screen. Change it to your deployed server (it can also be typed on
  the pairing screen during testing).

## Notes / follow-ups

- Location uses `PRIORITY_BALANCED_POWER_ACCURACY` at ~60s intervals; tune later.
- The device token is stored in SharedPreferences for now; moving it to EncryptedSharedPreferences
  is a planned hardening step.
- Background location is requested as a second step after foreground permission, so location keeps
  reporting when the app is not open.
