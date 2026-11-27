# Andsv — parent Android app

The parent's native Android app. It does what the web dashboard does, on the phone: sign in, see
your devices, and view a device's location. (The web dashboard remains available in any browser.)

## What it does today (Stage 1)

- Sign in or create an account against your deployed API.
- List the devices on your account with pairing / last-seen status.
- Open a device to see its latest location and history, and open that point in a maps app.

## Build it

Same as the monitored app. Every push to `monitor` builds a debug APK in GitHub Actions
(`andsv-parent-debug-apk` artifact). Or open `android/parent` in Android Studio, or:

```bash
cd android/parent
gradle assembleDebug          # output: app/build/outputs/apk/debug/app-debug.apk
```

On first launch, set the **Server address** to your deployed API, then sign in with the same
account you use on the web dashboard.

## Follow-ups

- Embed a map (the dashboard uses Leaflet); today the app opens the system maps app for a point.
- Push notifications for new alerts once alerts exist.
