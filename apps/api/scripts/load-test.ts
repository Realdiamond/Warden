// Load test for a pilot (docs/load-test.md). It plays many phones with the app open, each doing
// what the app does: check alerts every minute, refresh the map and responder areas when the
// map moves (about every 30 s), the community feed every few minutes, safe places now and then,
// and a few reports a minute across everyone. Each phone has its own install id, so the per-phone
// limits on reports apply exactly as in production; nothing is switched off.
//
//   node scripts/load-test.ts --url http://127.0.0.1:8080 --phases 500:60,2000:60,5000:30
//   node scripts/load-test.ts --seed 1500        # first fill the database (needs DATABASE_URL and keys)
//
// Seeding writes clearly synthetic reports marked source = 'demo'; never run it on a live server.

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { CATEGORIES, ReportSubmissionSchema, tilesAround } from "@warden/shared";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:8080" },
    phases: { type: "string", default: "500:60,2000:60,5000:30" },
    "reports-per-minute": { type: "string", default: "6" },
    seed: { type: "string" },
    out: { type: "string" },
  },
});

/** Where pilot phones are: most in Lagos, some in Abuja. */
const CITIES = [
  { name: "Lagos", lat: 6.52, lng: 3.38, spread: 0.12, weight: 0.8 },
  { name: "Abuja", lat: 9.05, lng: 7.49, spread: 0.08, weight: 0.2 },
];

function randomPoint() {
  const city = Math.random() < (CITIES[0]?.weight ?? 1) ? CITIES[0] : CITIES[1];
  if (!city) throw new Error("no city");
  return {
    lat: city.lat + (Math.random() * 2 - 1) * city.spread,
    lng: city.lng + (Math.random() * 2 - 1) * city.spread,
  };
}

const PUBLIC_CATEGORIES = CATEGORIES.filter((c) => c.handling === "public").map((c) => c.id);

// ---- Seeding --------------------------------------------------------------------------------

async function seed(incidents: number) {
  const { loadConfig } = await import("../src/config.ts");
  const { Cipher, Hasher } = await import("../src/crypto.ts");
  const { createPool } = await import("../src/db/pool.ts");
  const { createReport } = await import("../src/services/reports.ts");
  const { LogSmsSender } = await import("../src/sms/sender.ts");
  const config = loadConfig();
  if (config.env === "production")
    throw new Error("Refusing to seed load-test data in production.");
  const pool = createPool(config.databaseUrl);
  const base = {
    pool,
    cipher: new Cipher(config.fieldKeys),
    hasher: new Hasher(config.hmacKey),
    random: Math.random,
    sms: new LogSmsSender(() => undefined),
    smsHourlyCap: 0,
    publicWebUrl: null,
    signer: null,
  };
  const ids: string[] = [];
  const started = Date.now();
  for (let i = 0; i < incidents; i += 1) {
    const point = randomPoint();
    const categoryId = PUBLIC_CATEGORIES[Math.floor(Math.random() * PUBLIC_CATEGORIES.length)];
    // Spread over the last week; two reports from different phones so it is corroborated.
    const at = started - Math.random() * 7 * 24 * 3_600_000;
    for (let r = 0; r < 2; r += 1) {
      const submission = ReportSubmissionSchema.parse({
        categoryId,
        location: { lat: point.lat + r * 0.0004, lng: point.lng, accuracyM: 30 },
        description: "Load-test report. Not a real incident.",
        proximity: "here",
      });
      const result = await createReport(
        { ...base, now: () => new Date(at + r * 3 * 60_000) },
        { submission, installId: randomUUID(), idempotencyKey: randomUUID(), channel: "demo" },
      );
      if (result.ok) ids.push(result.receipt.reportId);
    }
  }
  await pool.query(
    `UPDATE incidents
        SET source = 'demo',
            publish_after = CASE WHEN publish_after IS NULL THEN NULL ELSE LEAST(publish_after, now()) END
      WHERE id IN (SELECT incident_id FROM reports WHERE id = ANY($1::uuid[]))`,
    [ids],
  );
  await pool.query(
    `UPDATE alert_events SET source = 'demo'
      WHERE incident_id IN (SELECT incident_id FROM reports WHERE id = ANY($1::uuid[]))`,
    [ids],
  );
  const { rows } = await pool.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM incidents WHERE publish_after IS NOT NULL AND publish_after <= now()",
  );
  console.log(
    `Seeded ${ids.length} reports in ${Math.round((Date.now() - started) / 1000)} s; ${rows[0]?.n} incidents can show on the map.`,
  );
  await pool.end();
}

// ---- Load ---------------------------------------------------------------------------------

interface Phone {
  install: string;
  here: { lat: number; lng: number };
  tiles: string[];
  cursor: string | null;
}

function makePhone(): Phone {
  const home = randomPoint();
  const work = randomPoint();
  return {
    install: randomUUID(),
    here: home,
    tiles: [...new Set([...tilesAround(home.lat, home.lng), ...tilesAround(work.lat, work.lng)])],
    cursor: null,
  };
}

/** About what the map shows at street level: a few kilometres across. */
function bboxAround(point: { lat: number; lng: number }, half = 0.03) {
  return [point.lng - half, point.lat - half, point.lng + half, point.lat + half]
    .map((n) => n.toFixed(5))
    .join(",");
}

type Route = "alerts" | "map" | "presence" | "community" | "safe-stops" | "report";

interface Stats {
  latencies: number[];
  ok: number;
  limited: number;
  errors: number;
  statuses: Record<string, number>;
}

function request(phone: Phone, route: Route): { url: string; init?: RequestInit } {
  const base = values.url ?? "";
  switch (route) {
    case "alerts": {
      const after = phone.cursor ? `&after=${phone.cursor}` : "";
      return { url: `${base}/v1/alerts?tiles=${phone.tiles.join(",")}${after}` };
    }
    case "map":
      return { url: `${base}/v1/map/incidents?bbox=${bboxAround(phone.here)}&window=24h` };
    case "presence":
      return { url: `${base}/v1/map/presence?bbox=${bboxAround(phone.here)}` };
    case "community":
      return { url: `${base}/v1/community/feed?bbox=${bboxAround(phone.here, 0.14)}` };
    case "safe-stops":
      return { url: `${base}/v1/safe-stops?bbox=${bboxAround(phone.here, 0.05)}` };
    case "report": {
      const categoryId = PUBLIC_CATEGORIES[Math.floor(Math.random() * PUBLIC_CATEGORIES.length)];
      return {
        url: `${base}/v1/reports`,
        init: {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-warden-install": phone.install,
            "idempotency-key": randomUUID(),
          },
          body: JSON.stringify({
            categoryId,
            location: { ...phone.here, accuracyM: 30 },
            description: "Load-test report. Not a real incident.",
            proximity: "here",
          }),
        },
      };
    }
  }
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

async function runPhase(phones: number, seconds: number, reportsPerMinute: number) {
  const fleet = Array.from({ length: phones }, makePhone);
  // Requests per second for each route, from how often one open app makes it.
  const rates: Record<Route, number> = {
    alerts: phones / 60,
    map: phones / 30,
    presence: phones / 30,
    community: phones / 300,
    "safe-stops": phones / 600,
    report: reportsPerMinute / 60,
  };
  const stats = {} as Record<Route, Stats>;
  for (const route of Object.keys(rates) as Route[]) {
    stats[route] = { latencies: [], ok: 0, limited: 0, errors: 0, statuses: {} };
  }
  const due = Object.fromEntries(Object.keys(rates).map((r) => [r, 0])) as Record<Route, number>;
  const inFlight = new Set<Promise<void>>();
  const started = performance.now();
  let last = started;

  const fire = (route: Route) => {
    const phone = fleet[Math.floor(Math.random() * fleet.length)];
    if (!phone) return;
    const { url, init } = request(phone, route);
    const sent = performance.now();
    const task = fetch(url, init)
      .then(async (response) => {
        const body = await response.text();
        const s = stats[route];
        s.latencies.push(performance.now() - sent);
        s.statuses[response.status] = (s.statuses[response.status] ?? 0) + 1;
        if (response.ok) {
          s.ok += 1;
          if (route === "alerts") {
            const cursor = (JSON.parse(body) as { cursor?: string | null }).cursor;
            if (cursor) phone.cursor = cursor;
          }
        } else if (response.status === 429) s.limited += 1;
        else s.errors += 1;
      })
      .catch(() => {
        stats[route].errors += 1;
        stats[route].statuses.network = (stats[route].statuses.network ?? 0) + 1;
      })
      .finally(() => inFlight.delete(task));
    inFlight.add(task);
  };

  while (performance.now() - started < seconds * 1000) {
    await new Promise((resolve) => setTimeout(resolve, 10));
    const now = performance.now();
    const elapsed = (now - last) / 1000;
    last = now;
    for (const route of Object.keys(rates) as Route[]) {
      due[route] += rates[route] * elapsed;
      while (due[route] >= 1) {
        due[route] -= 1;
        fire(route);
      }
    }
  }
  await Promise.all(inFlight);
  const wall = (performance.now() - started) / 1000;

  const rows = (Object.keys(rates) as Route[]).map((route) => {
    const s = stats[route];
    const sorted = [...s.latencies].sort((a, b) => a - b);
    const total = s.ok + s.limited + s.errors;
    return {
      route,
      requests: total,
      perSecond: Number((total / wall).toFixed(1)),
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      p99: Math.round(percentile(sorted, 99)),
      max: Math.round(sorted[sorted.length - 1] ?? 0),
      errors: s.errors,
      limited: s.limited,
      statuses: s.statuses,
    };
  });
  const all = (Object.values(stats) as Stats[]).flatMap((s) => s.latencies).sort((a, b) => a - b);
  const total = rows.reduce((sum, row) => sum + row.requests, 0);
  const errors = rows.reduce((sum, row) => sum + row.errors, 0);
  return {
    phones,
    seconds: Math.round(wall),
    requests: total,
    perSecond: Number((total / wall).toFixed(1)),
    p50: Math.round(percentile(all, 50)),
    p95: Math.round(percentile(all, 95)),
    p99: Math.round(percentile(all, 99)),
    errors,
    errorRate: total ? Number(((errors / total) * 100).toFixed(2)) : 0,
    routes: rows,
  };
}

if (values.seed) {
  await seed(Number(values.seed));
} else {
  const reportsPerMinute = Number(values["reports-per-minute"]);
  const results = [];
  for (const phase of (values.phases ?? "").split(",")) {
    const [phones, seconds] = phase.split(":").map(Number);
    if (!phones || !seconds) throw new Error(`Bad phase "${phase}"; use phones:seconds`);
    console.log(`\n== ${phones} phones with the app open, ${seconds} s`);
    const result = await runPhase(phones, seconds, reportsPerMinute);
    results.push(result);
    console.log(
      `${result.perSecond} requests/s · p50 ${result.p50} ms · p95 ${result.p95} ms · p99 ${result.p99} ms · errors ${result.errors} (${result.errorRate}%)`,
    );
    console.table(result.routes.map(({ statuses: _statuses, ...row }) => row));
  }
  if (values.out) writeFileSync(values.out, `${JSON.stringify(results, null, 2)}\n`);
}
