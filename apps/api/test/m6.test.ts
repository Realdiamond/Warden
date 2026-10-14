import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importSafeStops, stopsFromGeoJson } from "../src/services/safeStops.ts";
import { deliverDueSms } from "../src/services/sms.ts";
import { createTrustedReporter, revokeTrustedReporter } from "../src/services/trustedReporters.ts";
import {
  createTestContext,
  LAGOS,
  mapAround,
  serviceDeps,
  signInStaff,
  submitReport,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const MINUTE = 60_000;

interface Receipt {
  sessionId: string;
  viewToken: string;
  controlToken: string;
}

async function start(kind: "trip" | "sos"): Promise<Receipt> {
  const response = await ctx.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: { "x-warden-install": randomUUID() },
    payload: {
      kind,
      personName: "Ada",
      contacts: [{ name: "Mum", phone: "0803 123 4567" }],
      ...(kind === "trip"
        ? {
            destination: { lat: 6.45, lng: 3.4, label: "Lekki" },
            expectedArrivalAt: new Date(ctx.now().getTime() + 60 * MINUTE).toISOString(),
          }
        : {}),
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Receipt;
}

function control(r: Receipt, action: string, payload: Record<string, unknown>) {
  return ctx.app.inject({
    method: "POST",
    url: `/v1/sessions/${r.sessionId}/${action}`,
    headers: { "x-warden-session-control": r.controlToken },
    payload,
  });
}

async function view(r: Receipt) {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/v1/sessions/${r.sessionId}/view`,
    headers: { "x-warden-session-view": r.viewToken },
  });
  return response.json();
}

describe("off-route trips", () => {
  it("alarms contacts once when the person does not answer, and tells them when it is over", async () => {
    const trip = await start("trip");
    expect((await view(trip)).alarm).toBe(false);

    const flagged = await control(trip, "flag", { reason: "off_route" });
    expect(flagged.statusCode).toBe(200);
    expect((await control(trip, "flag", { reason: "off_route" })).statusCode).toBe(200);
    await deliverDueSms(serviceDeps(ctx));
    expect(ctx.sms.sent).toHaveLength(1);
    expect(ctx.sms.sent[0]?.text).toContain("Ada has moved away from their route to Lekki");

    const seen = await view(trip);
    expect(seen.alarm).toBe(true);
    expect(seen.offRouteAt).toBe(ctx.now().toISOString());

    await control(trip, "end", { outcome: "arrived" });
    await deliverDueSms(serviceDeps(ctx));
    expect(ctx.sms.sent.at(-1)?.text).toContain("Ada has arrived safely");
  });

  it("raises the duress alarm without ending the trip", async () => {
    const trip = await start("trip");
    expect((await control(trip, "flag", { reason: "duress" })).statusCode).toBe(200);
    await deliverDueSms(serviceDeps(ctx));
    expect(ctx.sms.sent[0]?.text).toContain("may be in danger");
    expect(await view(trip)).toMatchObject({ state: "active", duress: true, alarm: true });
  });

  it("refuses an off-route flag for an SOS, a wrong token or an ended trip", async () => {
    const sos = await start("sos");
    expect((await control(sos, "flag", { reason: "off_route" })).statusCode).toBe(409);
    const trip = await start("trip");
    const wrong = { ...trip, controlToken: trip.viewToken };
    expect((await control(wrong, "flag", { reason: "off_route" })).statusCode).toBe(404);
    await control(trip, "end", { outcome: "cancelled" });
    expect((await control(trip, "flag", { reason: "off_route" })).statusCode).toBe(409);
    expect((await control(trip, "flag", { reason: "lost" })).statusCode).toBe(400);
  });
});

describe("trusted reporters", () => {
  const robbery = { categoryId: "armed_robbery", location: LAGOS, proximity: "here" };

  function reportWithCode(code: string) {
    return ctx.app.inject({
      method: "POST",
      url: "/v1/reports",
      headers: {
        "x-warden-install": randomUUID(),
        "idempotency-key": randomUUID(),
        "x-warden-reporter-code": code,
      },
      payload: robbery,
    });
  }

  it("puts a trusted reporter's high-severity report on the map without a second report", async () => {
    const deps = serviceDeps(ctx);
    const { code } = await createTrustedReporter(deps, "Ikeja CDA chair", "test");
    expect(code).toMatch(/^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/);

    // Codes are accepted however they are typed.
    const response = await reportWithCode(code.toLowerCase().replaceAll("-", " "));
    expect(response.statusCode).toBe(201);
    ctx.advance(11 * MINUTE);
    const map = await mapAround(ctx);
    expect(map.incidents).toHaveLength(1);
    expect(map.incidents[0]).toMatchObject({ categoryId: "armed_robbery", label: "Unconfirmed" });

    // Moderators see that it was a trusted reporter, never which one.
    const { cookie } = await signInStaff(ctx);
    const detail = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/incidents/${map.incidents[0]?.id}`,
      headers: { cookie },
    });
    expect(detail.json().reports[0].trusted).toBe(true);
    const { rows } = await ctx.pool.query("SELECT * FROM reports");
    expect(Object.keys(rows[0])).not.toContain("trusted_reporter_id");
  });

  it("holds the same report from anyone else, and refuses revoked or made-up codes", async () => {
    expect((await submitReport(ctx, robbery)).statusCode).toBe(201);
    ctx.advance(11 * MINUTE);
    expect((await mapAround(ctx)).incidents).toHaveLength(0);

    const deps = serviceDeps(ctx);
    const { id, code } = await createTrustedReporter(deps, "Journalist", "test");
    expect(await revokeTrustedReporter(deps, id, "test", "Left the role")).toBe(true);
    expect((await reportWithCode(code)).statusCode).toBe(403);
    expect((await reportWithCode("AAAAA-BBBBB-CCCCC-DDDDD")).statusCode).toBe(403);

    const audit = await ctx.pool.query(
      "SELECT action FROM audit_events WHERE object_type = 'trusted_reporter' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "trusted_reporter.create",
      "trusted_reporter.revoke",
    ]);
  });
});

describe("safe stops", () => {
  const geojson = {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        id: "node/1",
        geometry: { type: "Point", coordinates: [3.35, 6.6] },
        properties: { amenity: "police", name: "Ikeja Police Station", opening_hours: "24/7" },
      },
      {
        type: "Feature",
        id: "node/2",
        geometry: { type: "Point", coordinates: [3.36, 6.59] },
        properties: { amenity: "hospital", name: "General Hospital", phone: "+234 1 000 0000" },
      },
      // Skipped: not a safe stop, no name, outside Nigeria.
      {
        type: "Feature",
        id: "node/3",
        geometry: { type: "Point", coordinates: [3.36, 6.59] },
        properties: { amenity: "bar", name: "A bar" },
      },
      {
        type: "Feature",
        id: "node/4",
        geometry: { type: "Point", coordinates: [3.37, 6.58] },
        properties: { amenity: "fuel" },
      },
      {
        type: "Feature",
        id: "node/5",
        geometry: { type: "Point", coordinates: [-0.12, 51.5] },
        properties: { amenity: "police", name: "London" },
      },
    ],
  };

  it("imports an OpenStreetMap export and serves the stops by area", async () => {
    const { stops, skipped } = stopsFromGeoJson(geojson);
    expect(stops).toHaveLength(2);
    expect(skipped).toBe(3);
    const deps = { pool: ctx.pool, now: ctx.now };
    await importSafeStops(deps, "osm", stops, { verified: false, actor: "test" });
    // Importing again updates instead of duplicating.
    await importSafeStops(deps, "osm", stops, { verified: true, actor: "test" });

    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/safe-stops?bbox=3.2,6.4,3.6,6.7",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { stops: Array<Record<string, unknown>> };
    expect(body.stops).toHaveLength(2);
    expect(body.stops.find((s) => s.kind === "police")).toMatchObject({
      name: "Ikeja Police Station",
      lat: 6.6,
      lng: 3.35,
      open24h: true,
      verified: true,
    });
    const elsewhere = await ctx.app.inject({
      method: "GET",
      url: "/v1/safe-stops?bbox=7.3,8.9,7.6,9.2",
    });
    expect(elsewhere.json().stops).toHaveLength(0);
  });
});
