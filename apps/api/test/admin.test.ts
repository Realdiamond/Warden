import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/services/audit.ts";
import { runHousekeeping } from "../src/services/incidents.ts";
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

const consoleHeaders = (cookie: string) => ({ cookie, "x-warden-console": "1" });

async function heldRobbery() {
  await submitReport(ctx, {
    categoryId: "armed_robbery",
    location: LAGOS,
    description: "Gunmen at the junction",
  });
  const { rows } = await ctx.pool.query<{ id: string }>("SELECT id FROM incidents");
  const id = rows[0]?.id;
  if (!id) throw new Error("no incident");
  return id;
}

describe("staff sign-in", () => {
  it("rejects a wrong password with the same message as an unknown email", async () => {
    await signInStaff(ctx);
    const wrong = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/login",
      headers: { "x-warden-console": "1" },
      payload: { email: "nobody@warden.test", password: "whatever-it-is" },
    });
    expect(wrong.statusCode).toBe(401);
    expect(wrong.json().title).toBe("Email or password is incorrect.");
  });

  it("sets an httpOnly, SameSite=Strict session cookie scoped to the admin API", async () => {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/login",
      headers: { "x-warden-console": "1" },
      payload: { email: "x@warden.test", password: "y" },
    });
    expect(response.statusCode).toBe(401);
    const { cookie } = await signInStaff(ctx);
    expect(cookie).toMatch(/^warden_staff=/);
  });

  it("requires a session for admin routes and the console header for changes", async () => {
    expect((await ctx.app.inject({ method: "GET", url: "/v1/admin/queue" })).statusCode).toBe(401);
    const { cookie } = await signInStaff(ctx);
    const id = await heldRobbery();
    const noHeader = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/incidents/${id}/actions`,
      headers: { cookie },
      payload: { action: "verify" },
    });
    expect(noHeader.statusCode).toBe(403);
  });

  it("expires a session after 30 idle minutes", async () => {
    const { cookie } = await signInStaff(ctx);
    expect(
      (await ctx.app.inject({ method: "GET", url: "/v1/admin/me", headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    ctx.advance(31 * 60_000);
    expect(
      (await ctx.app.inject({ method: "GET", url: "/v1/admin/me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });

  it("logs out and revokes the session", async () => {
    const { cookie } = await signInStaff(ctx);
    const out = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/logout",
      headers: consoleHeaders(cookie),
    });
    expect(out.statusCode).toBe(204);
    expect(
      (await ctx.app.inject({ method: "GET", url: "/v1/admin/me", headers: { cookie } }))
        .statusCode,
    ).toBe(401);
  });
});

describe("moderation", () => {
  it("lists held incidents with a review deadline", async () => {
    const { cookie } = await signInStaff(ctx);
    await heldRobbery();
    const queue = await ctx.app.inject({
      method: "GET",
      url: "/v1/admin/queue?state=held",
      headers: { cookie },
    });
    const [item] = queue.json().items;
    expect(item).toMatchObject({ categoryId: "armed_robbery", severity: "high", state: "held" });
    expect(item.reviewDueInMs).toBe(10 * 60_000);
  });

  it("shows moderators the decrypted report and audits that read", async () => {
    const { cookie } = await signInStaff(ctx);
    const id = await heldRobbery();
    const detail = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/incidents/${id}`,
      headers: { cookie },
    });
    expect(detail.statusCode).toBe(200);
    const body = detail.json();
    expect(body.reports[0].description).toBe("Gunmen at the junction");
    expect(body.reports[0].location).toMatchObject(LAGOS);
    expect(body.allowedActions).toEqual(["verify", "remove", "resolve"]);
    expect(body.audit[0].action).toBe("incident.view_restricted");
  });

  it("verifying publishes immediately with a Verified label", async () => {
    const { cookie } = await signInStaff(ctx);
    const id = await heldRobbery();
    expect((await mapAround(ctx)).incidents).toHaveLength(0);
    const verify = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/incidents/${id}/actions`,
      headers: consoleHeaders(cookie),
      payload: { action: "verify" },
    });
    expect(verify.json()).toMatchObject({ previousState: "held", state: "verified" });
    const [incident] = (await mapAround(ctx)).incidents;
    expect(incident).toMatchObject({ label: "Verified" });
  });

  it("requires a reason to remove, and removal takes the incident off the map", async () => {
    const { cookie } = await signInStaff(ctx);
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    const { rows } = await ctx.pool.query<{ id: string }>("SELECT id FROM incidents");
    const id = rows[0]?.id;
    expect((await mapAround(ctx)).incidents).toHaveLength(1);

    const noReason = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/incidents/${id}/actions`,
      headers: consoleHeaders(cookie),
      payload: { action: "remove" },
    });
    expect(noReason.statusCode).toBe(400);

    const removed = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/incidents/${id}/actions`,
      headers: consoleHeaders(cookie),
      payload: { action: "remove", reason: "Duplicate prank report" },
    });
    expect(removed.statusCode).toBe(200);
    expect((await mapAround(ctx)).incidents).toHaveLength(0);
  });

  it("refuses impossible transitions and verifying private categories", async () => {
    const { cookie } = await signInStaff(ctx);
    await submitReport(ctx, { categoryId: "domestic_violence", location: LAGOS });
    const { rows } = await ctx.pool.query<{ id: string }>("SELECT id FROM incidents");
    const response = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/incidents/${rows[0]?.id}/actions`,
      headers: consoleHeaders(cookie),
      payload: { action: "verify" },
    });
    expect(response.statusCode).toBe(409);
  });

  it("keeps an intact audit chain that detects tampering", async () => {
    const { cookie } = await signInStaff(ctx);
    const id = await heldRobbery();
    await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/incidents/${id}/actions`,
      headers: consoleHeaders(cookie),
      payload: { action: "verify" },
    });
    await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/incidents/${id}/actions`,
      headers: consoleHeaders(cookie),
      payload: { action: "resolve" },
    });
    const chain = await verifyAuditChain(ctx.pool);
    expect(chain).toMatchObject({ ok: true });
    if (chain.ok) expect(chain.entries).toBeGreaterThanOrEqual(4);

    await expect(ctx.pool.query("UPDATE audit_events SET reason = 'edited'")).rejects.toThrow(
      /append-only/,
    );
    await expect(ctx.pool.query("DELETE FROM audit_events")).rejects.toThrow(/append-only/);
  });
});

describe("housekeeping", () => {
  it("resolves incidents with no new reports after their active window", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    ctx.advance(6 * 3_600_000 + 1);
    expect(await runHousekeeping(serviceDeps(ctx))).toEqual({ expired: 1 });
    const map = await mapAround(ctx);
    expect(map.incidents[0]).toMatchObject({ label: "Resolved", active: false });
  });
});
