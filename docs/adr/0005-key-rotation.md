# 0005 — Changing encryption and signing keys

Status: accepted (M5)

## Context

Two server keys protect Warden. The field key encrypts Restricted data at rest (exact report
locations and text, trip and SOS details, live points, queued text messages). The signing key
signs responder broadcasts, and phones trust only the public key built into the app. Until M5
neither could be changed without losing data or breaking broadcasts on phones in the field.

## Decision

- **Field key.** Every encrypted row already stores the id of the key that locked it. The server
  now takes the current key plus any number of old ones (`WARDEN_OLD_FIELD_KEYS`, "id:key"
  pairs): it encrypts only with the current key and decrypts with whichever key a row names.
  `rotate-field-key` re-encrypts rows on old keys in small transactions (`FOR UPDATE SKIP
  LOCKED`), so the service stays up, and writes one audit entry per run. Once no rows remain on
  an old key, it is removed from the settings.
- **Signing key.** Broadcasts already carry the signer's key id. The app setting
  `WARDEN_BROADCAST_PUBLIC_KEY` now accepts a list of "id:key" pairs, and a phone checks each
  broadcast against the key with the same id. A broadcast naming a key the build does not trust
  is dropped, never shown as official. A single bare key (the M4 format) is still accepted and
  trusted for any id. The order is: ship a build that trusts old and new keys, switch the
  server, later drop the old key from builds.
- `gen-keys --new-field-key <id>` and `gen-keys --new-signing-key <id>` print the settings for
  each step. The steps are in `docs/deploy.md` ("Changing keys").

## Consequences

- Phones that never update stop showing broadcasts once the server switches keys. That is the
  safe failure: a missed broadcast, not a forged one.
- Backups taken before a field-key rotation still need the old key.
- The HMAC key (rate limits, USSD caller hashes) is not rotated; changing it only resets rate
  limits and reaction de-duplication, so a plain replacement is acceptable.
