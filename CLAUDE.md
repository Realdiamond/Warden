# Warden — notes for Claude

Warden is a safety intelligence and response network for Nigeria: a live safety map, anonymous
reporting, verified alerts, trip safety and SOS. The full requirements (business, product,
technical, security, roadmap) are in the
[Warden 2.0 Requirements Set](https://claude.ai/code/artifact/9e32d210-e4da-4bad-b899-a11b5ba06bcf).
Build progress is tracked in `docs/milestones.md`; decisions are in `docs/adr/`.

## Working with the founder

The founder does not write code. Claude writes all of it; the founder tests on an Android phone
and handles accounts, partners and legal work. Explain changes in plain language, and never ask
for passwords or API keys in chat — they go in environment secrets.

## Layout

- `packages/shared` — category taxonomy, payload schemas, publication rules, H3 helpers. Used by
  every other package; change rules here, not in the apps.
- `apps/api` — Fastify API on Node 22+ (runs `.ts` files directly), PostgreSQL 16 + PostGIS.
- `apps/console` — React + Vite moderator console.
- `apps/mobile` — Expo / React Native Android app.

## Commands

- `pnpm install` — install everything (flat `node_modules`, see `.npmrc`).
- `pnpm typecheck`, `pnpm test`, `pnpm lint` — run across all packages.
- API tests need PostgreSQL with PostGIS. In cloud sessions `.claude/hooks/session-start.sh`
  installs and starts it and creates the `warden_dev` and `warden_test` databases.

## Rules that must not be broken

- Exact locations and report text are encrypted at rest (`apps/api/src/crypto.ts`); the public
  only ever sees H3 areas. Never return exact coordinates from a public endpoint.
- Never log IP addresses or device identifiers on anonymous routes.
- Parameterised SQL only.
- Private categories (sexual and domestic violence, missing persons) never appear on the map.
- Every moderator action writes to the hash-chained audit log.
- TypeScript must be erasable (no enums, namespaces or parameter properties) and relative imports
  use the `.ts` extension, so Node can run the API without a build step.
