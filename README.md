# Warden

A safety intelligence and response network for Nigeria: a live safety map, anonymous reporting
in any language, verified alerts, trip safety and SOS.

- **Requirements:** [Warden 2.0 Requirements Set](https://claude.ai/code/artifact/9e32d210-e4da-4bad-b899-a11b5ba06bcf)
- **Progress:** [docs/milestones.md](docs/milestones.md)
- **Decisions:** [docs/adr](docs/adr)
- **Original v1 documents:** `Warden.zip`

## What is in this repository

| Folder | What it is |
| --- | --- |
| `apps/mobile` | Android app (Expo / React Native) |
| `apps/console` | Moderator web console (React) |
| `apps/api` | Backend API (Node.js, Fastify, PostgreSQL + PostGIS) |
| `packages/shared` | Rules shared by all of the above |

## Getting the test app on your phone

Every push builds an Android APK and publishes it on the repository's
[Releases page](https://github.com/Realdiamond/Warden/releases) as a pre-release. Open that page
on your Android phone, download the newest `warden-*.apk`, and allow installs from your browser
when Android asks. Until a server is set up, the app runs in demo mode with sample data.

## For developers

```bash
pnpm install
pnpm typecheck && pnpm test
```

Each app has its own README with run instructions.
