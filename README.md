# Andsv

A **consent-based family device monitoring** system. A parent (or guardian, or a company
managing its own devices) can see activity on a monitored Android phone and set limits on it —
with the knowledge and agreement of the person using that phone.

This is a standalone project. It shares no code with anything else on other branches of this
repository, and this branch is **not** meant to be merged into `main`.

## The rule everything else depends on

Andsv is **overt**, never covert. The monitored phone always knows it is being monitored:

- A permanent, visible notice and the app's own icon stay on the monitored phone.
- Consent is recorded at setup, and the API refuses to activate a device without it.
- When the parent views the screen live or controls the phone, an indicator shows on that phone
  while it happens.
- Nothing hides the app or disguises what it does.

We do not build a hidden or disguised mode. That is stalkerware, it is illegal to use against
another adult without their knowledge, and it is banned from app stores. Because of the depth of
some features, the monitored app is distributed as a direct download (APK), not via Google Play.

## Pieces

- `packages/shared` — types and rules shared by every part (event kinds, payload shapes,
  sensitivity classification, pairing contracts).
- `services/api` — the backend: accounts, device pairing, encrypted event storage, and (later) the
  real-time relay for live view and control. Node 22 + TypeScript, run directly without a build.
- `web/dashboard` — the parent's web dashboard (React + Vite). *(coming)*
- `android/child` — the monitored Android app, native Kotlin. *(coming)*
- `android/parent` — the parent's Android app, native Kotlin. *(coming)*

## Running the API

```bash
pnpm install
pnpm dev:api        # starts the API on http://localhost:4000
pnpm test           # runs the test suite
```

See `docs/architecture.md` for the design and the build roadmap, and `docs/milestones.md` for
where we are.
