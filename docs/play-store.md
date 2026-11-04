# Putting Warden on the Google Play Store

This is the path from today's test APKs to Warden in the Play Store. Steps 1 and 5 happen in
Google Play Console; steps 2 to 4 are a few clicks on GitHub. Nobody needs to type code, and no
key or password is ever sent in chat.

Test APKs (the `test-build-N` releases) carry on as before: demo mode, a development key, for
testing only. Play Store builds are separate: they use the live server, start out of demo mode,
and are signed with Warden's own upload key. A phone that has a test APK must uninstall it once
before installing the Play Store version, because the two are signed differently.

## 1. Open a Google Play developer account

At <https://play.google.com/console>. There is a one-off registration fee.

- An **organisation** account needs the company registration (CAC) and a free D-U-N-S number
  for the company, which can take a few weeks to arrive. Apps from organisations show the company
  as the developer, which builds trust for a safety app.
- A **personal** account is quicker to open, but Google currently requires new personal accounts
  to run a closed test with at least 12 testers for 14 days before the app can go public.

## 2. Make the upload key (once)

The upload key proves that a new version really comes from Warden. Google keeps the separate
key that phones check (Play App Signing), so a lost upload key can be replaced through Google
support, but it is still worth guarding.

1. Make a long password (at least 16 characters; a password manager can generate one) and keep
   it somewhere safe.
2. In GitHub: **Settings → Secrets and variables → Actions → New repository secret**. Name it
   `WARDEN_UPLOAD_STORE_PASSWORD` and paste the password.
3. In GitHub: **Actions → "Make the Play upload key (run once)" → Run workflow**. It takes about
   a minute and refuses to run if a key is already saved.
4. Open the finished run and download **warden-upload-key** (it expires after a day). Inside:
   - `warden-upload-key.p12`, the key itself, locked with your password. Keep a copy in two
     safe places (for example a password manager and an encrypted drive).
   - `warden-upload-key.base64.txt`, the same key as text.
5. Add a second secret named `WARDEN_UPLOAD_KEYSTORE_BASE64` and paste the whole contents of the
   `.txt` file. Then delete the downloaded files from your phone or computer's Downloads.

## 3. Point the release at the live server

Once the server from [deploy.md](deploy.md) is running, add two **variables** (not secrets) in
**Settings → Secrets and variables → Actions → Variables**:

- `WARDEN_API_URL`: the server address, such as `https://api.warden.ng`.
- `WARDEN_BROADCAST_PUBLIC_KEY`: the public broadcast key printed by
  `docker compose exec api node apps/api/src/cli/gen-keys.ts --public`.

## 4. Build a release

**Actions → "Play Store release" → Run workflow**, and type the version people will see, such as
`1.0.0`. After about 15 minutes the run offers a download named like
`warden-1.0.0-100031` containing:

- `…aab`: the file to upload to Play Console.
- `…-64bit.apk` and `…-32bit.apk`: the same app as installable files, for pilot testers who
  are not using the Play Store. Most phones need the 64-bit one.

The workflow stops with a plain message if a secret or variable from steps 2 and 3 is missing.
Each run gets a higher version number automatically, as the Play Store requires.

## 5. Set up the app in Play Console

Start with **Internal testing** (up to 100 testers, no review wait), then a closed test, then
production.

- **Play App Signing**: accept Google's default when you upload the first `.aab`.
- **Privacy policy**: `https://<your domain>/privacy` (served by the console; see
  [legal/privacy-notice.md](legal/privacy-notice.md)). It must be the lawyer-approved text
  before the app goes public.
- **App access**: the app works without an account; say so.
- **Ads**: none.
- **Content rating**: answer honestly that users can report violent crime and share their
  location with contacts. The questionnaire gives the rating.
- **Target audience**: 18 and over is the safest choice for the pilot (reports of violence,
  location sharing); ask the lawyer before choosing a younger age.
- **Screenshots**: the "Warden App Screens" gallery has phone screenshots of every screen; take
  fresh ones from a real phone for the listing if possible.
- **Data safety**: the draft answers below.

### Store listing (draft)

- **App name** (30 characters at most): `Warden: Safety Map & SOS`
- **Short description** (80 at most): `See what's happening near you, report safely, and get help fast with SOS.`
- **Full description**:

  > Warden is a safety map for Nigeria, built with privacy first.
  >
  > • See what's happening near you: checked reports of crime, road trouble and hazards, shown
  > as areas, never exact spots.
  > • Report in seconds, without your name. Warden never asks who you are.
  > • Get alerts near home, work or school, with quiet hours at night.
  > • Share a trip: the people you trust can follow your journey and are told if you are late or
  > go off route.
  > • SOS: after a five-second countdown, your trusted contacts get a text with your live
  > location. A safety PIN stops it; a duress PIN looks the same but quietly warns them.
  > • Private reports of sexual or domestic violence and missing persons go only to trained
  > staff and never appear on the map.
  > • Night mode, a typeface made to be easy to read, English and Pidgin.
  >
  > Warden does not replace 112. In danger, call 112 first if you can.

### Data safety answers (draft, to check with the lawyer)

These describe what the code does today. Collected means it reaches Warden's server.

| Data type | Collected? | Why | Notes |
| --- | --- | --- | --- |
| Precise location | Yes | Report location; live location during a trip or SOS | Report location is encrypted and only staff (and responders in the area) see it; the public sees areas. Trip and SOS locations go only to the person's chosen contacts and are deleted 2 days after the session ends. |
| Approximate location | Yes | Loading the map, alerts and the community feed for the area on screen | Only boxes of map area, never the phone's own position. |
| Name | Optional | The name in SOS and trip texts ("Ada needs help") | Sent only when a trip or SOS starts; deleted with the session. |
| Phone numbers (contacts') | Yes, during a trip or SOS | Texting the person's trusted contacts | Kept only while the session lasts plus 2 days; never in an address book. |
| Photos and videos | Optional | Attached to a report | Staff only; GPS and phone details removed; deleted after 30 days. |
| Audio | Optional | Voice notes on reports; SOS sound (off by default) | Deleted after 30 days. |
| Other user-generated content | Yes | Report descriptions and community tips | Report text encrypted; tips checked by a moderator before anyone sees them. |
| Device or other IDs | Yes | A random install ID for rate limits and counting independent reports | Not linked to a person; stored only as a keyed hash. |

- **Shared with third parties**: No. The SMS provider sends texts on Warden's behalf, which
  Google's form counts as a service provider, not sharing.
- **Encrypted in transit**: Yes (HTTPS only).
- **Can people ask for their data to be deleted?** Most data deletes itself (sessions after 2
  days, media after 30). Reports are anonymous, so Warden cannot tell whose they are; decide with
  the lawyer how a deletion request is handled and give an email address for it.
- **Open decision**: reports (their exact place and words, encrypted) are kept with no end date
  today. Choose a period with the lawyer; the code can then delete or strip them automatically.

## Later: uploading straight from GitHub

Once the first version is live, a Play Console service account can let the release workflow upload
each new `.aab` to internal testing by itself. That needs a Google Cloud service account key
stored as a GitHub secret; ask for it when the manual uploads become tedious.
