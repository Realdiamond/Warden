# Load test

**Short answer:** one pilot server copes easily. With 500 phones all using the app at the same
moment, the server answered every request, 99 in 100 within 12 milliseconds. It kept that up to
10,000 phones at once (20 times the pilot) and only fell behind somewhere between 10,000 and
20,000. Even then it did not crash, and it was back to normal seconds after the load stopped.

Tested on 4 November 2026 with `apps/api/scripts/load-test.ts`.

## What was tested

The test plays many phones with the Warden app open, each doing what the app does:

| What the app does | How often, per phone with the app open |
| --- | --- |
| Checks for alerts near its places (two places, 18 alert tiles) | every 60 seconds |
| Loads incidents for the map view | every 30 seconds (as the map moves) |
| Loads responder areas for the map view | every 30 seconds |
| Loads the community feed | every 5 minutes |
| Loads safe places | every 10 minutes |
| Sends a report | 6 a minute across all phones together |

Each simulated phone has its own install id, home and work spread around Lagos (80%) and Abuja
(20%), and passes back the alert cursor the server gives it, as the real app does. The per-phone
limits on reports stay switched on, exactly as in production.

The database held 1,507 incidents (3,000 reports from the last week, about 215 of them in the
default 24-hour map), 1,507 alert events and the demo safe places. All were made through the
server's real reporting code and marked as demo data.

"All phones open at once" is a deliberately harsh assumption: in a real pilot most phones are in
pockets with the app closed, checking alerts only every 15 minutes or so in the background.

## Results

| Phones with the app open | Requests a second | Typical (p50) | 95 in 100 within | 99 in 100 within | Errors |
| --- | --- | --- | --- | --- | --- |
| 500 (pilot) | 44 | 5 ms | 8 ms | 12 ms | 0 |
| 2,000 | 177 | 3 ms | 7 ms | 10 ms | 0 |
| 5,000 | 441 | 3 ms | 7 ms | 11 ms | 0 |
| 10,000 | 883 | 6 ms | 11 ms | 15 ms | 0 |
| 20,000 (overloaded) | 498 of the 1,770 asked for | 7 s | 25 s | 56 s | 1.4% |

Reports were sent at 6 a minute in every run and were all accepted, typically in 13 to 22 ms.

How busy the server was:

- At 500 phones the API used about 6% of one processor core and 150 MB of memory.
- At 10,000 phones it used about 61% of a core (71% at peak) and 155 MB; PostgreSQL used about
  74% of a core.
- At 20,000 phones the API used a whole core (it runs its JavaScript on one core) and 303 MB,
  and requests queued up. All the errors were connections the test machine gave up on; the
  server itself returned no errors and logged none. Five seconds after the test ended,
  `/readyz` answered in 6 ms and the background work had kept running throughout.

## What this means for the pilot

- The recommended pilot server (2 processors, 4 GB of memory, docs/deploy.md) has about 20 times
  more room than a 500-phone pilot needs, even if every phone has the app open at once.
- For a real phone, the server's few milliseconds are a small part of the wait. The mobile
  network (3G or 4G) adds roughly 0.1 to 0.5 seconds, more where the signal is weak.
- When Warden grows towards 10,000 phones using the app at the same moment, run two or more
  copies of the API behind Caddy and move the rate limits to a shared store (planned in
  `apps/api/src/rateLimit.ts`). Map and responder responses already tell phones and caches to
  reuse them for 30 seconds, which a cache in front of the API can take advantage of.

## Limits of this test

- It ran on a 4-core, 15 GB cloud machine with PostgreSQL, the API and the test itself on the
  same machine. The test competes with the server for processor time, so the top-end numbers
  are a little pessimistic; a 2-processor server is likely to top out somewhat lower.
- There was no HTTPS in front (Caddy adds encryption work on the real server) and no mobile
  network in between.
- It covers the routes phones use without signing in. The moderator console, trips and SOS
  updates are used by far fewer people at a time and were not part of this test.

## Running it again

On a development machine with PostgreSQL (never on the live server: seeding writes test data):

```bash
cd apps/api
# 1. Fill a development database (needs DATABASE_URL, WARDEN_FIELD_KEY and WARDEN_HMAC_KEY).
pnpm migrate && pnpm seed-demo
pnpm load-test --seed 1500
# 2. Start the API in another terminal, as in production.
NODE_ENV=production PORT=8090 node src/main.ts
# 3. Run the phases: phones:seconds, comma-separated.
pnpm load-test --url http://127.0.0.1:8090 --phases 500:60,2000:60,5000:30 --out results.json
```
