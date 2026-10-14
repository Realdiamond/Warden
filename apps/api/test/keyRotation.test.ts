import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.ts";
import { Cipher } from "../src/crypto.ts";
import { verifyAuditChain } from "../src/services/audit.ts";
import {
  countOldKeyRows,
  ENCRYPTED_TABLES,
  reencryptOldKeyRows,
} from "../src/services/keyRotation.ts";
import { createTestContext, LAGOS, submitReport, type TestContext } from "./helpers.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const BASE_ENV = {
  DATABASE_URL: "postgres://localhost/x",
  WARDEN_FIELD_KEY: randomBytes(32).toString("base64"),
  WARDEN_HMAC_KEY: randomBytes(32).toString("base64"),
};

/** Some of every kind of encrypted row: a report, a retried request, a trip with a point, a tip,
 * a photo and an SOS audio clip. */
async function storeSomePrivateData() {
  const install = randomUUID();
  const report = await submitReport(
    ctx,
    { categoryId: "theft", location: LAGOS, description: "Two men on a red okada" },
    { install },
  );
  expect(report.statusCode).toBe(201);
  const trip = await ctx.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: { "x-warden-install": install },
    payload: {
      kind: "sos",
      personName: "Ada",
      contacts: [{ name: "Mum", phone: "0803 123 4567" }],
    },
  });
  expect(trip.statusCode).toBe(201);
  const { sessionId, controlToken } = trip.json() as { sessionId: string; controlToken: string };
  const point = await ctx.app.inject({
    method: "POST",
    url: `/v1/sessions/${sessionId}/points`,
    headers: { "x-warden-session-control": controlToken },
    payload: { points: [{ ...LAGOS, at: ctx.now().toISOString() }] },
  });
  expect(point.statusCode).toBeLessThan(300);
  const tip = await ctx.app.inject({
    method: "POST",
    url: "/v1/community/tips",
    headers: { "x-warden-install": install },
    payload: { body: "Avoid the junction after dark this week.", location: LAGOS },
  });
  expect(tip.statusCode).toBe(202);
  const { reportId, statusToken } = report.json() as { reportId: string; statusToken: string };
  const photo = await ctx.app.inject({
    method: "POST",
    url: `/v1/reports/${reportId}/media`,
    headers: { "x-warden-status-token": statusToken, "content-type": "image/jpeg" },
    // A minimal JPEG: start of image, then the scan.
    payload: Buffer.concat([
      Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x04, 1, 1]),
      Buffer.alloc(64, 1),
    ]),
  });
  expect(photo.statusCode).toBe(201);
  const clip = await ctx.app.inject({
    method: "POST",
    url: `/v1/sessions/${sessionId}/audio`,
    headers: { "x-warden-session-control": controlToken, "content-type": "audio/mp4" },
    payload: Buffer.concat([
      Buffer.from([0, 0, 0, 0x20]),
      Buffer.from("ftypM4A "),
      Buffer.alloc(64),
    ]),
  });
  expect(clip.statusCode).toBe(201);
}

describe("changing the field encryption key", () => {
  it("re-encrypts every private column so the old key can be dropped", async () => {
    await storeSomePrivateData();
    const newKey = randomBytes(32);
    const rotating = new Cipher({
      currentKeyId: "k2",
      keys: new Map([...ctx.config.fieldKeys.keys, ["k2", newKey]]),
    });

    const before = await countOldKeyRows(ctx.pool, "k2");
    for (const { table } of ENCRYPTED_TABLES) expect(before[table]).toBeGreaterThan(0);

    const done = await reencryptOldKeyRows(
      { pool: ctx.pool, cipher: rotating, now: ctx.now },
      { batchSize: 1 },
    );
    expect(done).toEqual(before);
    expect(Object.values(await countOldKeyRows(ctx.pool, "k2")).every((n) => n === 0)).toBe(true);

    // Everything now reads with the new key alone, and says the same as before.
    const newOnly = new Cipher({ currentKeyId: "k2", keys: new Map([["k2", newKey]]) });
    for (const { table, columns } of ENCRYPTED_TABLES) {
      const { rows } = await ctx.pool.query(`SELECT * FROM ${table}`);
      for (const row of rows) {
        expect(row.key_id).toBe("k2");
        for (const { name, purpose } of columns) {
          if (row[name] !== null)
            expect(() => newOnly.decrypt(purpose, "k2", row[name])).not.toThrow();
        }
      }
    }
    const { rows } = await ctx.pool.query("SELECT description_enc FROM reports");
    expect(newOnly.decrypt("report.description", "k2", rows[0].description_enc)).toBe(
      "Two men on a red okada",
    );

    // The run is recorded in the audit log, and running again does nothing.
    const audit = await ctx.pool.query(
      "SELECT details FROM audit_events WHERE action = 'field_key.reencrypt'",
    );
    expect(audit.rows[0].details.rows.reports).toBe(1);
    expect((await verifyAuditChain(ctx.pool)).ok).toBe(true);
    const again = await reencryptOldKeyRows({ pool: ctx.pool, cipher: rotating, now: ctx.now });
    expect(Object.values(again).every((n) => n === 0)).toBe(true);
  });

  it("stops without changing anything when an old key is missing", async () => {
    await storeSomePrivateData();
    const withoutOld = new Cipher({
      currentKeyId: "k2",
      keys: new Map([["k2", randomBytes(32)]]),
    });
    await expect(
      reencryptOldKeyRows({ pool: ctx.pool, cipher: withoutOld, now: ctx.now }),
    ).rejects.toThrow(/Unknown field key/);
    const left = await countOldKeyRows(ctx.pool, "k2");
    expect(left.reports).toBe(1);
  });

  it("reads old keys from WARDEN_OLD_FIELD_KEYS and rejects mistakes", () => {
    const old = randomBytes(32).toString("base64");
    const config = loadConfig({
      ...BASE_ENV,
      WARDEN_FIELD_KEY_ID: "k2",
      WARDEN_OLD_FIELD_KEYS: `k1:${old}`,
    });
    expect(config.fieldKeys.currentKeyId).toBe("k2");
    expect([...config.fieldKeys.keys.keys()]).toEqual(["k2", "k1"]);
    expect(loadConfig(BASE_ENV).fieldKeys.keys.size).toBe(1);

    expect(() => loadConfig({ ...BASE_ENV, WARDEN_OLD_FIELD_KEYS: `k1:${old}` })).toThrow(
      /used twice/,
    );
    expect(() => loadConfig({ ...BASE_ENV, WARDEN_OLD_FIELD_KEYS: old })).toThrow(/k1:/);
    expect(() => loadConfig({ ...BASE_ENV, WARDEN_OLD_FIELD_KEYS: "k0:c2hvcnQ=" })).toThrow(
      /32 bytes/,
    );
  });
});
