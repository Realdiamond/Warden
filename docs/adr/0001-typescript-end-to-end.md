# ADR-0001: TypeScript end to end

- Status: Accepted
- Date: 2026-10-05

## Context

The v2.0 Technical Requirements chose ASP.NET Core for the backend because the v1 plan cited
existing team expertise in C#. The founder has since confirmed that they will not write code;
Claude writes the code and the founder tests and runs the business. Future engineers will be
hired in Nigeria, where JavaScript and TypeScript developers are the largest pool.

## Decision

Use TypeScript for every part of Warden:

- **API:** Node.js 22+ running TypeScript natively (type stripping), Fastify, PostgreSQL with PostGIS.
- **Web consoles:** React with Vite.
- **Mobile app:** React Native with Expo.
- **Shared package:** `@warden/shared` holds the category taxonomy, payload schemas and the
  publication rules, so the app, console and API cannot disagree about them.

The rest of the v2.0 architecture is unchanged: separate SOS path, event backbone when needed,
H3 grid, field-level encryption, MapLibre and OpenStreetMap.

## Consequences

- One language and one toolchain (pnpm, Biome, Vitest) for a very small team.
- Validation and business rules are written once and reused on every surface.
- Code must use erasable TypeScript only (no enums, namespaces or parameter properties) so Node
  can run it without a build step.
- The Technical tab of the requirements set is updated to match.
