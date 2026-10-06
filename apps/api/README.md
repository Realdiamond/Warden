# @warden/api

Fastify API on Node.js 22.18+ (runs TypeScript directly, no build step) with PostgreSQL 16 and PostGIS.

## Run locally

```bash
cp .env.example .env
pnpm gen-keys            # paste the two keys into .env
pnpm migrate             # or set MIGRATE_ON_START=true
pnpm seed-demo           # synthetic incidents around Lagos and Abuja
STAFF_PASSWORD='choose-a-long-password' pnpm create-staff --email you@example.com --role admin
pnpm dev                 # http://localhost:8080
```

## Test

Tests run against a real PostgreSQL with PostGIS. Each test gets its own schema.

```bash
TEST_DATABASE_URL=postgres://warden:warden_dev@localhost:5432/warden_test pnpm test
```

## Endpoints (milestone 1)

| Method and path | Who | What |
| --- | --- | --- |
| `POST /v1/reports` | Anyone (headers `X-Warden-Install`, `Idempotency-Key`) | Anonymous report |
| `GET /v1/reports/:id/status` | The reporter (`X-Warden-Status-Token`) | Status of one's own report |
| `GET /v1/map/incidents?bbox=&window=&categories=` | Anyone | Public incidents as H3 areas |
| `GET /v1/alerts?tiles=&after=` | Anyone | Alert events for coarse 0.1° tiles; phones match saved places locally |
| `POST /v1/incidents/:id/reactions` | Anyone (header `X-Warden-Install`) | `confirm`, `over` or `false`; one per phone per incident |
| `POST /v1/admin/login`, `POST /v1/admin/logout`, `GET /v1/admin/me` | Staff | Session cookie |
| `GET /v1/admin/queue?state=` | Staff | Moderation queue |
| `GET /v1/admin/incidents/:id` | Staff | Detail with decrypted reports (audited) |
| `POST /v1/admin/incidents/:id/actions` | Staff | verify, hold, remove, resolve, dispute, reopen |
| `GET /healthz` | Anyone | Liveness and database check |

Admin requests that change anything must send `X-Warden-Console: 1`.
