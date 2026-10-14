import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApiClient, revokeApiClient } from "../src/services/dataApi.ts";
import { createOrganisation } from "../src/services/responders.ts";
import { createStaff } from "../src/services/staff.ts";
import {
  createTestContext,
  LAGOS,
  serviceDeps,
  signInResponder,
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
const CONSOLE = { "x-warden-console": "1" };

/** Two reports of a robbery: on the public map once the publication delay has passed. */
async function publicRobbery(at = LAGOS) {
  await submitReport(ctx, { categoryId: "armed_robbery", location: at, proximity: "here" });
  await submitReport(ctx, { categoryId: "armed_robbery", location: at, proximity: "here" });
}

async function signInFleet() {
  const { id: organisationId } = await createOrganisation(
    ctx.pool,
    { name: "Test Haulage Ltd", kind: "fleet", jurisdiction: null },
    ctx.now(),
  );
  const email = `ops-${randomBytes(3).toString("hex")}@haulage.test`;
  const password = "correct horse battery staple";
  await createStaff(ctx.pool, { email, password, role: "fleet", organisationId }, ctx.now());
  const response = await ctx.app.inject({
    method: "POST",
    url: "/v1/admin/login",
    headers: CONSOLE,
    payload: { email, password },
  });
  const cookie = response.cookies.find((c) => c.name === "warden_staff");
  if (!cookie) throw new Error(`Login failed: ${response.body}`);
  return { organisationId, cookie: `warden_staff=${cookie.value}` };
}

describe("fleet dashboard", () => {
  it("shows public incidents around the fleet's places, and nothing private", async () => {
    const fleet = await signInFleet();
    const add = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/fleet/zones",
      headers: { cookie: fleet.cookie, ...CONSOLE },
      payload: { name: "Apapa depot", center: { lat: 6.53, lng: 3.38 }, radiusM: 3000 },
    });
    expect(add.statusCode).toBe(201);
    await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/fleet/zones",
      headers: { cookie: fleet.cookie, ...CONSOLE },
      payload: { name: "Abuja yard", center: { lat: 9.06, lng: 7.49 }, radiusM: 3000 },
    });

    await publicRobbery();
    await submitReport(ctx, { categoryId: "sexual_violence", location: LAGOS, proximity: "here" });
    ctx.advance(11 * MINUTE);

    const overview = await ctx.app.inject({
      method: "GET",
      url: "/v1/admin/fleet/overview",
      headers: { cookie: fleet.cookie },
    });
    expect(overview.statusCode).toBe(200);
    const zones = overview.json().zones as Array<{
      zone: { name: string };
      incidents: Array<Record<string, unknown>>;
      bySeverity: Record<string, number>;
    }>;
    const depot = zones.find((z) => z.zone.name === "Apapa depot");
    expect(depot?.incidents).toHaveLength(1);
    expect(depot?.incidents[0]).toMatchObject({ categoryId: "armed_robbery" });
    expect(depot?.bySeverity.high).toBe(1);
    expect(zones.find((z) => z.zone.name === "Abuja yard")?.incidents).toEqual([]);
    // Only what the public map shows: areas, never reports or exact points.
    const text = overview.body;
    expect(text).not.toContain("sexual_violence");
    expect(text).not.toContain(String(LAGOS.lat));
    expect(text).not.toContain("description");

    const route = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/fleet/route-check",
      headers: { cookie: fleet.cookie, ...CONSOLE },
      payload: { from: { lat: 6.5, lng: 3.35 }, to: { lat: 6.55, lng: 3.4 } },
    });
    expect(route.statusCode).toBe(200);
    expect(route.json()).toMatchObject({ tooLong: false, level: expect.any(String) });
    expect(route.json().score).toBeLessThan(100);

    const far = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/fleet/route-check",
      headers: { cookie: fleet.cookie, ...CONSOLE },
      payload: { from: LAGOS, to: { lat: 11.83, lng: 13.15 } },
    });
    expect(far.json().tooLong).toBe(true);
  });

  it("keeps each fleet to its own places and its own screens", async () => {
    const a = await signInFleet();
    const b = await signInFleet();
    const zone = (
      await ctx.app.inject({
        method: "POST",
        url: "/v1/admin/fleet/zones",
        headers: { cookie: a.cookie, ...CONSOLE },
        payload: { name: "Ikeja office", center: LAGOS, radiusM: 1000 },
      })
    ).json() as { id: string };

    const listB = await ctx.app.inject({
      method: "GET",
      url: "/v1/admin/fleet/zones",
      headers: { cookie: b.cookie },
    });
    expect(listB.json().items).toEqual([]);
    const deleteByB = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/admin/fleet/zones/${zone.id}`,
      headers: { cookie: b.cookie, ...CONSOLE },
    });
    expect(deleteByB.statusCode).toBe(404);
    const deleteByA = await ctx.app.inject({
      method: "DELETE",
      url: `/v1/admin/fleet/zones/${zone.id}`,
      headers: { cookie: a.cookie, ...CONSOLE },
    });
    expect(deleteByA.statusCode).toBe(204);

    for (const url of [
      "/v1/admin/queue",
      "/v1/admin/news",
      "/v1/admin/responder/incidents",
      "/v1/admin/responder/sos",
      `/v1/admin/incidents/${randomUUID()}`,
    ]) {
      const response = await ctx.app.inject({ method: "GET", url, headers: { cookie: a.cookie } });
      expect(response.statusCode, url).toBe(403);
    }
    const me = await ctx.app.inject({
      method: "GET",
      url: "/v1/admin/me",
      headers: { cookie: a.cookie },
    });
    expect(me.json()).toMatchObject({ role: "fleet", organisation: { kind: "fleet" } });

    // Moderators and responders cannot use the fleet screens.
    const moderator = await signInStaff(ctx);
    const responder = await signInResponder(ctx);
    for (const cookie of [moderator.cookie, responder.cookie]) {
      const response = await ctx.app.inject({
        method: "GET",
        url: "/v1/admin/fleet/overview",
        headers: { cookie },
      });
      expect(response.statusCode).toBe(403);
    }

    const audit = await ctx.pool.query(
      "SELECT action FROM audit_events WHERE object_type = 'fleet_zone' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["fleet_zone.create", "fleet_zone.delete"]);
  });

  it("never mixes up fleet and responder accounts", async () => {
    const { id: police } = await createOrganisation(
      ctx.pool,
      { name: "Police", kind: "police", jurisdiction: null },
      ctx.now(),
    );
    const { id: haulage } = await createOrganisation(
      ctx.pool,
      { name: "Haulage", kind: "fleet", jurisdiction: null },
      ctx.now(),
    );
    const password = "correct horse battery staple";
    await expect(
      createStaff(
        ctx.pool,
        { email: "x@a.test", password, role: "fleet", organisationId: police },
        ctx.now(),
      ),
    ).rejects.toThrow(/fleet company/);
    await expect(
      createStaff(
        ctx.pool,
        { email: "y@a.test", password, role: "responder", organisationId: haulage },
        ctx.now(),
      ),
    ).rejects.toThrow(/fleet role/);
  });
});

describe("risk-data API", () => {
  function get(url: string, key?: string) {
    return ctx.app.inject({
      method: "GET",
      url,
      headers: key ? { authorization: `Bearer ${key}` } : {},
    });
  }

  it("needs a valid key and gives only area counts above the minimum", async () => {
    const deps = serviceDeps(ctx);
    const { key } = await createApiClient(
      deps,
      { name: "Acme Insurance", dailyQuota: 100 },
      "test",
    );
    expect(key).toMatch(/^wdn_/);

    expect((await get("/v1/data/areas?bbox=3.2,6.4,3.6,6.7")).statusCode).toBe(401);
    expect((await get("/v1/data/areas?bbox=3.2,6.4,3.6,6.7", "wdn_madeup")).statusCode).toBe(401);

    // Two public incidents in one area: fewer than the minimum, so not listed.
    await publicRobbery();
    ctx.advance(2 * 86_400_000);
    await publicRobbery();
    ctx.advance(11 * MINUTE);
    const few = await get("/v1/data/areas?bbox=3.2,6.4,3.6,6.7", key);
    expect(few.statusCode).toBe(200);
    expect(few.json()).toMatchObject({ areas: [], days: 30, minIncidents: 3 });

    ctx.advance(86_400_000);
    await publicRobbery();
    await submitReport(ctx, { categoryId: "sexual_violence", location: LAGOS, proximity: "here" });
    ctx.advance(11 * MINUTE);
    const enough = await get("/v1/data/areas?bbox=3.2,6.4,3.6,6.7&days=7", key);
    const areas = enough.json().areas as Array<Record<string, unknown>>;
    expect(areas).toHaveLength(1);
    expect(areas[0]).toMatchObject({
      incidents: 3,
      bySeverity: { critical: 0, high: 3, standard: 0 },
      byGroup: { violent_crime: 3 },
    });
    expect(enough.body).not.toContain("sexual_violence");
    expect(enough.body).not.toContain(String(LAGOS.lat));
    expect((await get("/v1/data/areas?bbox=3.2,6.4,3.6,6.7&days=12", key)).statusCode).toBe(400);
    expect((await get("/v1/data/outlook?bbox=3.2,6.4,3.6,6.7", key)).statusCode).toBe(200);
  });

  it("counts requests, stops at the daily quota and refuses revoked keys", async () => {
    const deps = serviceDeps(ctx);
    const { id, key } = await createApiClient(deps, { name: "Small plan", dailyQuota: 2 }, "test");
    expect((await get("/v1/data/outlook?bbox=3.2,6.4,3.6,6.7", key)).statusCode).toBe(200);
    expect((await get("/v1/data/outlook?bbox=3.2,6.4,3.6,6.7", key)).statusCode).toBe(200);
    expect((await get("/v1/data/outlook?bbox=3.2,6.4,3.6,6.7", key)).statusCode).toBe(429);

    const usage = await get("/v1/data/usage", key);
    expect(usage.statusCode).toBe(200);
    expect(usage.json()).toMatchObject({ name: "Small plan", dailyQuota: 2 });
    expect(usage.json().days[0].requests).toBe(3);

    // A new day in Nigeria starts a new quota.
    ctx.advance(86_400_000);
    expect((await get("/v1/data/outlook?bbox=3.2,6.4,3.6,6.7", key)).statusCode).toBe(200);

    expect(await revokeApiClient(deps, id, "test", "Contract ended")).toBe(true);
    expect((await get("/v1/data/usage", key)).statusCode).toBe(401);
    const audit = await ctx.pool.query(
      "SELECT action FROM audit_events WHERE object_type = 'api_client' ORDER BY id",
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["api_client.create", "api_client.revoke"]);
    // Only a keyed hash of the key is stored.
    const { rows } = await ctx.pool.query("SELECT * FROM api_clients");
    expect(JSON.stringify(rows)).not.toContain(key.slice(10));
  });

  it("never logs the key", async () => {
    const { key } = await createApiClient(
      serviceDeps(ctx),
      { name: "Logs", dailyQuota: 10 },
      "test",
    );
    await get("/v1/data/usage", key);
    expect(ctx.logs.join("\n")).not.toContain(key);
  });
});
