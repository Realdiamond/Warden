import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, LAGOS, mapAround, submitReport, type TestContext } from "./helpers.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const MINUTE = 60_000;

describe("anonymous reports", () => {
  it("puts a standard report on the map as unconfirmed, at area precision only", async () => {
    const response = await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    expect(response.statusCode).toBe(201);
    const receipt = response.json();
    expect(receipt.reportId).toMatch(/[0-9a-f-]{36}/);
    expect(receipt.statusToken.length).toBeGreaterThan(30);

    const map = await mapAround(ctx);
    expect(map.incidents).toHaveLength(1);
    const incident = map.incidents[0];
    expect(incident).toMatchObject({ categoryId: "theft", label: "Unconfirmed", reportCount: 1 });

    // The exact point never leaves the server: only the H3 cell, its centre and its outline.
    const body = JSON.stringify(map);
    expect(body).not.toContain(String(LAGOS.lat));
    expect(body).not.toContain(String(LAGOS.lng));
    expect(incident?.boundary).toHaveLength(7);
  });

  it("replays the same receipt for a retried request and stores one report", async () => {
    const install = randomUUID();
    const key = randomUUID();
    const first = await submitReport(
      ctx,
      { categoryId: "theft", location: LAGOS },
      { install, key },
    );
    const retry = await submitReport(
      ctx,
      { categoryId: "theft", location: LAGOS },
      { install, key },
    );
    expect(retry.statusCode).toBe(201);
    expect(retry.headers["idempotent-replayed"]).toBe("true");
    expect(retry.json()).toEqual(first.json());
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM reports");
    expect(rows[0].n).toBe(1);
  });

  it("stores the exact location and text only as ciphertext", async () => {
    await submitReport(ctx, {
      categoryId: "theft",
      location: LAGOS,
      description: "Two men on a red okada",
    });
    const { rows } = await ctx.pool.query("SELECT location_enc, description_enc FROM reports");
    const raw = Buffer.concat([rows[0].location_enc, rows[0].description_enc]).toString("latin1");
    expect(raw).not.toContain("okada");
    expect(raw).not.toContain("6.5244");
  });

  it("holds a single armed-robbery report until a second phone corroborates it", async () => {
    await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS });
    expect((await mapAround(ctx)).incidents).toHaveLength(0);

    // The same phone again does not count as corroboration.
    const install = randomUUID();
    await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS }, { install });
    await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS }, { install });
    let { rows } = await ctx.pool.query("SELECT state, independent_reports FROM incidents");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: "unconfirmed", independent_reports: 2 });

    // Published after the random delay (2 minutes with the test's random = 0), not before.
    expect((await mapAround(ctx)).incidents).toHaveLength(0);
    ctx.advance(2 * MINUTE);
    const map = await mapAround(ctx);
    expect(map.incidents).toHaveLength(1);
    expect(map.incidents[0]).toMatchObject({ label: "Corroborated", reportCount: 3 });

    ({ rows } = await ctx.pool.query("SELECT action FROM audit_events"));
    expect(rows.map((r) => r.action)).toContain("incident.released");
  });

  it("merges reports from a neighbouring street but not a different category", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    await submitReport(ctx, { categoryId: "theft", location: { lat: 6.5252, lng: 3.3799 } });
    await submitReport(ctx, { categoryId: "crash", location: LAGOS });
    const { rows } = await ctx.pool.query(
      "SELECT category_id, report_count FROM incidents ORDER BY category_id",
    );
    expect(rows).toEqual([
      { category_id: "crash", report_count: 1 },
      { category_id: "theft", report_count: 2 },
    ]);
  });

  it("starts a new incident when the last report is more than an hour old", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    ctx.advance(61 * MINUTE);
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM incidents");
    expect(rows[0].n).toBe(2);
  });

  it("never shows private categories on the map", async () => {
    for (let i = 0; i < 3; i += 1) {
      await submitReport(ctx, { categoryId: "sexual_violence", location: LAGOS });
    }
    ctx.advance(30 * MINUTE);
    expect((await mapAround(ctx)).incidents).toHaveLength(0);
  });

  it("uses the wider area for critical incidents", async () => {
    await submitReport(ctx, { categoryId: "kidnapping", location: LAGOS });
    await submitReport(ctx, { categoryId: "kidnapping", location: LAGOS });
    ctx.advance(3 * MINUTE);
    const [incident] = (await mapAround(ctx)).incidents;
    // H3 resolution is encoded in the index: resolution 8 cells start with "88".
    expect(String(incident?.cell)).toMatch(/^88/);
  });

  it("rejects locations outside Nigeria and unknown categories", async () => {
    const accra = await submitReport(ctx, {
      categoryId: "theft",
      location: { lat: 5.6037, lng: -0.187 },
    });
    expect(accra.statusCode).toBe(422);
    const bogus = await submitReport(ctx, { categoryId: "bogus", location: LAGOS });
    expect(bogus.statusCode).toBe(400);
    expect(bogus.headers["content-type"]).toContain("application/problem+json");
  });

  it("requires install and idempotency headers", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/reports",
      payload: { categoryId: "theft", location: LAGOS },
    });
    expect(response.statusCode).toBe(400);
  });

  it("limits one phone to 10 reports an hour", async () => {
    const install = randomUUID();
    for (let i = 0; i < 10; i += 1) {
      const ok = await submitReport(ctx, { categoryId: "theft", location: LAGOS }, { install });
      expect(ok.statusCode).toBe(201);
    }
    const blocked = await submitReport(ctx, { categoryId: "theft", location: LAGOS }, { install });
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("shows the reporter the status of their own report with the status token only", async () => {
    const install = randomUUID();
    const receipt = (
      await submitReport(ctx, { categoryId: "theft", location: LAGOS }, { install })
    ).json();
    const status = await ctx.app.inject({
      method: "GET",
      url: `/v1/reports/${receipt.reportId}/status`,
      headers: { "x-warden-install": install, "x-warden-status-token": receipt.statusToken },
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ status: "on_map", reportCount: 1 });

    const wrong = await ctx.app.inject({
      method: "GET",
      url: `/v1/reports/${receipt.reportId}/status`,
      headers: { "x-warden-install": install, "x-warden-status-token": "guess" },
    });
    expect(wrong.statusCode).toBe(404);
  });

  it("never writes IP addresses or install ids to the logs", async () => {
    const install = randomUUID();
    await submitReport(ctx, { categoryId: "theft", location: LAGOS }, { install });
    const logText = ctx.logs.join("\n");
    expect(ctx.logs.length).toBeGreaterThan(0);
    expect(logText).not.toContain("127.0.0.1");
    expect(logText).not.toContain("remoteAddress");
    expect(logText).not.toContain(install);
  });
});
