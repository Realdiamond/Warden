import { randomUUID } from "node:crypto";
import { tileFor, tilesAround } from "@warden/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

const MINUTE = 60_000;
const TILES = tilesAround(LAGOS.lat, LAGOS.lng).join(",");

interface Feed {
  alerts: Array<Record<string, unknown>>;
  cursor: string | null;
}

async function feed(after?: string): Promise<Feed> {
  const query = after ? `tiles=${TILES}&after=${after}` : `tiles=${TILES}`;
  const response = await ctx.app.inject({ method: "GET", url: `/v1/alerts?${query}` });
  expect(response.statusCode).toBe(200);
  return response.json() as Feed;
}

function react(id: string, kind: string, install = randomUUID()) {
  return ctx.app.inject({
    method: "POST",
    url: `/v1/incidents/${id}/reactions`,
    headers: { "x-warden-install": install },
    payload: { kind },
  });
}

async function onlyIncidentId(): Promise<string> {
  const { rows } = await ctx.pool.query<{ id: string }>("SELECT id FROM incidents");
  expect(rows).toHaveLength(1);
  return rows[0]?.id ?? "";
}

async function moderate(id: string, action: string, reason?: string) {
  const { cookie } = await signInStaff(ctx);
  const response = await ctx.app.inject({
    method: "POST",
    url: `/v1/admin/incidents/${id}/actions`,
    headers: { cookie, "x-warden-console": "1" },
    payload: reason ? { action, reason } : { action },
  });
  expect(response.statusCode).toBe(200);
}

describe("alert feed", () => {
  it("serves a new public incident at area precision once it has settled", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    // Too fresh: events are served only once they are a few seconds old.
    expect((await feed()).alerts).toHaveLength(0);

    ctx.advance(10_000);
    const { alerts, cursor } = await feed();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      kind: "new",
      tier: "advisory",
      categoryId: "theft",
      label: "Unconfirmed",
    });
    const body = JSON.stringify(alerts);
    expect(body).not.toContain(String(LAGOS.lat));
    expect(body).not.toContain(String(LAGOS.lng));
    expect(cursor).toBe(alerts[0]?.id);

    // Asking again with the cursor returns nothing new, and the cursor stays put.
    const again = await feed(cursor ?? undefined);
    expect(again.alerts).toHaveLength(0);
    expect(again.cursor).toBe(cursor);
  });

  it("only returns alerts for the tiles asked for", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    ctx.advance(10_000);
    const abuja = tilesAround(9.0765, 7.3986).join(",");
    const response = await ctx.app.inject({ method: "GET", url: `/v1/alerts?tiles=${abuja}` });
    expect(response.json().alerts).toHaveLength(0);
    expect(tilesAround(LAGOS.lat, LAGOS.lng)).toContain(tileFor(LAGOS.lat, LAGOS.lng));
  });

  it("does not alert before a delayed high-severity incident is published", async () => {
    await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS });
    await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS });
    ctx.advance(MINUTE);
    expect((await feed()).alerts).toHaveLength(0);
    ctx.advance(2 * MINUTE);
    const { alerts } = await feed();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "new", tier: "warning", label: "Corroborated" });
  });

  it("never alerts for private categories", async () => {
    await submitReport(ctx, { categoryId: "sexual_violence", location: LAGOS });
    await submitReport(ctx, { categoryId: "sexual_violence", location: LAGOS });
    ctx.advance(30 * MINUTE);
    expect((await feed()).alerts).toHaveLength(0);
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM alert_events");
    expect(rows[0].n).toBe(0);
  });

  it("withdraws a scheduled alert when a moderator removes the incident first", async () => {
    await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS });
    await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS });
    await moderate(await onlyIncidentId(), "remove", "Prank");
    ctx.advance(30 * MINUTE);
    expect((await feed()).alerts).toHaveLength(0);
  });

  it("follows verification and resolution with upgraded and resolved alerts", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    const id = await onlyIncidentId();
    ctx.advance(MINUTE);
    await moderate(id, "verify");
    ctx.advance(MINUTE);
    await moderate(id, "resolve");
    ctx.advance(10_000);
    const kinds = (await feed()).alerts.map((a) => [a.kind, a.label]);
    expect(kinds).toEqual([
      ["new", "Unconfirmed"],
      ["upgraded", "Verified"],
      ["resolved", "Resolved"],
    ]);
  });

  it("verifying a held incident sends a single new alert straight away", async () => {
    await submitReport(ctx, { categoryId: "kidnapping", location: LAGOS });
    const id = await onlyIncidentId();
    await moderate(id, "verify");
    ctx.advance(10_000);
    const { alerts } = await feed();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ kind: "new", tier: "critical", label: "Verified" });
  });

  it("tells people who were warned when an incident expires", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    ctx.advance(10_000);
    const first = await feed();
    expect(first.alerts.map((a) => a.kind)).toEqual(["new"]);

    ctx.advance(7 * 60 * MINUTE);
    await runHousekeeping(serviceDeps(ctx));
    ctx.advance(10_000);
    expect((await feed(first.cursor ?? undefined)).alerts.map((a) => a.kind)).toEqual(["resolved"]);
  });

  it("rejects malformed tile lists", async () => {
    for (const query of [
      "",
      "tiles=",
      "tiles=abc",
      `tiles=${Array.from({ length: 55 }, (_, i) => `1_${i}`).join(",")}`,
      "tiles=1_1&after=x",
    ]) {
      const response = await ctx.app.inject({ method: "GET", url: `/v1/alerts?${query}` });
      expect(response.statusCode, query).toBe(400);
    }
  });
});

describe("community reactions", () => {
  it("counts confirmations from other phones towards the Corroborated label", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    const id = await onlyIncidentId();
    const response = await react(id, "confirm");
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: true, label: "Corroborated" });
    expect((await mapAround(ctx)).incidents[0]).toMatchObject({ label: "Corroborated" });
  });

  it("accepts one reaction per phone, and does not count a reporter's own confirmation", async () => {
    const install = randomUUID();
    await submitReport(ctx, { categoryId: "theft", location: LAGOS }, { install });
    const id = await onlyIncidentId();
    expect((await react(id, "confirm", install)).json()).toMatchObject({ accepted: false });

    const other = randomUUID();
    expect((await react(id, "over", other)).json()).toMatchObject({ accepted: true });
    expect((await react(id, "over", other)).json()).toMatchObject({ accepted: false });
    const { rows } = await ctx.pool.query("SELECT over_votes, confirmations FROM incidents");
    expect(rows[0]).toEqual({ over_votes: 1, confirmations: 0 });
  });

  it("resolves an unconfirmed incident after two phones say it is over, with an audit entry", async () => {
    await submitReport(ctx, { categoryId: "road_blockage", location: LAGOS });
    const id = await onlyIncidentId();
    await react(id, "over");
    const second = await react(id, "over");
    expect(second.json()).toEqual({ accepted: true, label: "Resolved" });

    const { rows } = await ctx.pool.query(
      "SELECT action, actor_id FROM audit_events WHERE object_id = $1",
      [id],
    );
    expect(rows).toContainEqual({ action: "incident.community_resolved", actor_id: "community" });
    ctx.advance(10_000);
    expect((await feed()).alerts.map((a) => a.kind)).toEqual(["new", "resolved"]);
    expect((await react(id, "confirm")).statusCode).toBe(409);
  });

  it("disputes an unconfirmed incident after three false votes", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    const id = await onlyIncidentId();
    await react(id, "false");
    await react(id, "false");
    const third = await react(id, "false");
    expect(third.json()).toEqual({ accepted: true, label: "Disputed" });
    ctx.advance(10_000);
    expect((await feed()).alerts.map((a) => a.kind)).toEqual(["new", "correction"]);
  });

  it("never lets reactions close a critical incident without a moderator", async () => {
    await submitReport(ctx, { categoryId: "kidnapping", location: LAGOS });
    const id = await onlyIncidentId();
    await moderate(id, "verify");
    for (let i = 0; i < 5; i += 1) await react(id, "over");
    const { rows } = await ctx.pool.query("SELECT state, over_votes FROM incidents");
    expect(rows[0]).toEqual({ state: "verified", over_votes: 5 });
  });

  it("treats held, private and unknown incidents as not found", async () => {
    await submitReport(ctx, { categoryId: "kidnapping", location: LAGOS });
    const held = await onlyIncidentId();
    expect((await react(held, "confirm")).statusCode).toBe(404);
    expect((await react(randomUUID(), "confirm")).statusCode).toBe(404);
    expect((await react("not-a-uuid", "confirm")).statusCode).toBe(404);

    await ctx.pool.query("DELETE FROM reports");
    await ctx.pool.query("DELETE FROM incidents");
    await submitReport(ctx, { categoryId: "domestic_violence", location: LAGOS });
    expect((await react(await onlyIncidentId(), "confirm")).statusCode).toBe(404);
  });

  it("validates the body and the install header, and logs neither", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    const id = await onlyIncidentId();
    const install = randomUUID();
    expect((await react(id, "maybe", install)).statusCode).toBe(400);
    const noHeader = await ctx.app.inject({
      method: "POST",
      url: `/v1/incidents/${id}/reactions`,
      payload: { kind: "confirm" },
    });
    expect(noHeader.statusCode).toBe(400);
    expect(ctx.logs.join("\n")).not.toContain(install);
  });
});
