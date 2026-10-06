// Fills a development or demo database with clearly synthetic incidents around Lagos and Abuja.
// They are marked source = 'demo'. Refuses to run against production unless --force is given.
//   pnpm --filter @warden/api seed-demo

import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { ReportSubmissionSchema } from "@warden/shared";
import { loadConfig } from "../config.ts";
import { Cipher, Hasher } from "../crypto.ts";
import { createPool } from "../db/pool.ts";
import type { ServiceDeps } from "../services/deps.ts";
import { createReport } from "../services/reports.ts";
import { LogSmsSender } from "../sms/sender.ts";

const { values } = parseArgs({ options: { force: { type: "boolean", default: false } } });
const config = loadConfig();
if (config.env === "production" && !values.force) {
  console.error("Refusing to seed demo data in production without --force.");
  process.exit(1);
}

interface DemoReport {
  place: string;
  lat: number;
  lng: number;
  categoryId: string;
  hoursAgo: number;
  /** Extra reports from other phones, to show corroboration. */
  extraReports?: number;
}

const DEMO: DemoReport[] = [
  { place: "Ikeja", lat: 6.6018, lng: 3.3515, categoryId: "phone_snatching", hoursAgo: 1 },
  { place: "Yaba", lat: 6.5095, lng: 3.3711, categoryId: "theft", hoursAgo: 3 },
  {
    place: "Ojuelegba",
    lat: 6.51,
    lng: 3.364,
    categoryId: "one_chance",
    hoursAgo: 2,
    extraReports: 1,
  },
  { place: "Oshodi", lat: 6.555, lng: 3.3439, categoryId: "road_blockage", hoursAgo: 0.5 },
  { place: "Lekki", lat: 6.4474, lng: 3.472, categoryId: "flood", hoursAgo: 4, extraReports: 2 },
  { place: "Surulere", lat: 6.4969, lng: 3.3481, categoryId: "crash", hoursAgo: 1.5 },
  {
    place: "Mile 2",
    lat: 6.4655,
    lng: 3.317,
    categoryId: "armed_robbery",
    hoursAgo: 5,
    extraReports: 1,
  },
  {
    place: "Ikorodu",
    lat: 6.6194,
    lng: 3.5105,
    categoryId: "fake_checkpoint",
    hoursAgo: 2.5,
    extraReports: 1,
  },
  { place: "Victoria Island", lat: 6.4281, lng: 3.4219, categoryId: "protest", hoursAgo: 0.75 },
  { place: "Garki", lat: 9.031, lng: 7.488, categoryId: "theft", hoursAgo: 2 },
  { place: "Wuse", lat: 9.0765, lng: 7.479, categoryId: "suspicious_behaviour", hoursAgo: 1 },
  {
    place: "Nyanya",
    lat: 9.017,
    lng: 7.565,
    categoryId: "armed_robbery",
    hoursAgo: 6,
    extraReports: 2,
  },
  { place: "Kubwa", lat: 9.15, lng: 7.34, categoryId: "fire", hoursAgo: 3, extraReports: 1 },
  { place: "Lugbe", lat: 8.98, lng: 7.38, categoryId: "kidnapping", hoursAgo: 8, extraReports: 1 },
  { place: "Gwarinpa", lat: 9.11, lng: 7.4, categoryId: "crash", hoursAgo: 0.25 },
  // Single reports of serious incidents wait in the moderation queue.
  { place: "Allen Avenue", lat: 6.6012, lng: 3.3567, categoryId: "assault", hoursAgo: 0.1 },
  { place: "Area 11", lat: 9.0475, lng: 7.4911, categoryId: "gunfire_heard", hoursAgo: 0.05 },
  { place: "Ajah", lat: 6.4698, lng: 3.5852, categoryId: "kidnapping", hoursAgo: 0.08 },
  { place: "Mushin", lat: 6.5273, lng: 3.3414, categoryId: "domestic_violence", hoursAgo: 0.3 },
];

const pool = createPool(config.databaseUrl);
const realNow = Date.now();
const baseDeps = {
  pool,
  cipher: new Cipher({
    currentKeyId: config.fieldKeyId,
    keys: new Map([[config.fieldKeyId, config.fieldKey]]),
  }),
  hasher: new Hasher(config.hmacKey),
  random: Math.random,
  // Demo reports never send text messages.
  sms: new LogSmsSender(() => undefined),
  smsHourlyCap: 0,
  publicWebUrl: null,
};

const reportIds: string[] = [];
try {
  for (const item of DEMO) {
    for (let i = 0; i <= (item.extraReports ?? 0); i += 1) {
      // Spread corroborating reports a few minutes apart and up to ~150 m away.
      const at = new Date(realNow - item.hoursAgo * 3_600_000 + i * 4 * 60_000);
      const deps: ServiceDeps = { ...baseDeps, now: () => at };
      const submission = ReportSubmissionSchema.parse({
        categoryId: item.categoryId,
        location: { lat: item.lat + i * 0.0008, lng: item.lng - i * 0.0006, accuracyM: 25 },
        description: `Demo report near ${item.place}. Not a real incident.`,
        proximity: "here",
      });
      const result = await createReport(deps, {
        submission,
        installId: randomUUID(),
        idempotencyKey: randomUUID(),
        channel: "demo",
      });
      if (result.ok) reportIds.push(result.receipt.reportId);
    }
  }
  const { rowCount } = await pool.query(
    `UPDATE incidents
        SET source = 'demo',
            publish_after = CASE WHEN publish_after IS NULL THEN NULL ELSE LEAST(publish_after, now()) END
      WHERE id IN (SELECT incident_id FROM reports WHERE id = ANY($1::uuid[]))`,
    [reportIds],
  );
  // Alerts for demo incidents carry the demo source so phones can label them as not real.
  await pool.query(
    `UPDATE alert_events SET source = 'demo'
      WHERE incident_id IN (SELECT incident_id FROM reports WHERE id = ANY($1::uuid[]))`,
    [reportIds],
  );
  console.log(`Seeded ${reportIds.length} demo reports into ${rowCount} incidents.`);
} finally {
  await pool.end();
}
