import { createPublicKey, randomUUID, verify } from "node:crypto";
import { broadcastSigningText, type SignedBroadcast, tilesAround } from "@warden/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/services/audit.ts";
import { Signer } from "../src/signing.ts";
import { ussdStep } from "../src/ussd/menu.ts";
import {
  createTestContext,
  LAGOS,
  mapAround,
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

const ABUJA = { lat: 9.0765, lng: 7.3986 };
const MINUTE = 60_000;

function as(cookie: string, method: "GET" | "POST", url: string, payload?: unknown) {
  return ctx.app.inject({
    method,
    url,
    headers: { cookie, "x-warden-console": "1" },
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });
}

async function onlyIncidentId(): Promise<string> {
  const { rows } = await ctx.pool.query<{ id: string }>("SELECT id FROM incidents");
  return rows[0]?.id ?? "";
}

describe("responder access", () => {
  it("shows incidents in the organisation's area only, and never private categories", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS });
    await submitReport(ctx, { categoryId: "theft", location: ABUJA });
    await submitReport(ctx, { categoryId: "sexual_violence", location: LAGOS });
    await submitReport(ctx, { categoryId: "kidnapping", location: LAGOS }); // held, critical
    await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS }); // held, high
    const { cookie } = await signInResponder(ctx);

    const inbox = await as(cookie, "GET", "/v1/admin/responder/incidents");
    expect(inbox.statusCode).toBe(200);
    const items = inbox.json().items as Array<{ categoryId: string; state: string }>;
    expect(items.map((i) => i.categoryId).sort()).toEqual(["kidnapping", "theft"]);
    expect(items.find((i) => i.categoryId === "kidnapping")?.state).toBe("held");
    // The list shows areas; exact points only in the audited detail view.
    expect(JSON.stringify(items)).not.toContain(String(LAGOS.lat));
  });

  it("opens the detail with exact locations and records it in the audit log", async () => {
    await submitReport(ctx, { categoryId: "theft", location: LAGOS, description: "Red bike" });
    const id = await onlyIncidentId();
    const { cookie } = await signInResponder(ctx);
    const detail = await as(cookie, "GET", `/v1/admin/responder/incidents/${id}`);
    expect(detail.statusCode).toBe(200);
    expect(detail.json().reports[0]).toMatchObject({ description: "Red bike", location: LAGOS });
    const { rows } = await ctx.pool.query(
      "SELECT action FROM audit_events WHERE object_id = $1 AND action = 'incident.view_restricted'",
      [id],
    );
    expect(rows).toHaveLength(1);
  });

  it("keeps responders and moderators to their own screens", async () => {
    await submitReport(ctx, { categoryId: "theft", location: ABUJA });
    const outside = await onlyIncidentId();
    const responder = await signInResponder(ctx);
    expect((await as(responder.cookie, "GET", "/v1/admin/queue")).statusCode).toBe(403);
    expect((await as(responder.cookie, "GET", `/v1/admin/incidents/${outside}`)).statusCode).toBe(
      403,
    );
    expect(
      (await as(responder.cookie, "GET", `/v1/admin/responder/incidents/${outside}`)).statusCode,
    ).toBe(404);
    const moderator = await signInStaff(ctx);
    expect((await as(moderator.cookie, "GET", "/v1/admin/responder/incidents")).statusCode).toBe(
      403,
    );
    const me = await as(responder.cookie, "GET", "/v1/admin/me");
    expect(me.json()).toMatchObject({ role: "responder", organisation: { kind: "police" } });
  });

  it("posts public updates that show on the map, and can close an incident", async () => {
    await submitReport(ctx, { categoryId: "road_blockage", location: LAGOS });
    const id = await onlyIncidentId();
    const { cookie } = await signInResponder(ctx, { name: "LASTMA" });
    const update = await as(cookie, "POST", `/v1/admin/responder/incidents/${id}/updates`, {
      kind: "responding",
    });
    expect(update.json()).toEqual({ state: "unconfirmed" });
    expect((await mapAround(ctx)).incidents[0]?.responder).toMatchObject({
      kind: "responding",
      organisation: "LASTMA",
      text: "Responders on the way",
    });

    await as(cookie, "POST", `/v1/admin/responder/incidents/${id}/updates`, { kind: "resolved" });
    expect((await mapAround(ctx)).incidents[0]).toMatchObject({ label: "Resolved", active: false });
    expect(await verifyAuditChain(ctx.pool)).toMatchObject({ ok: true });
  });
});

describe("deployments", () => {
  it("shows public deployments as areas and hides the rest", async () => {
    const { cookie } = await signInResponder(ctx);
    const base = { kind: "checkpoint", location: LAGOS, durationMinutes: 60 };
    for (const [label, visibility] of [
      ["Street", "public_street"],
      ["Area", "public_area"],
      ["Responders", "responders"],
      ["Hidden", "hidden"],
    ]) {
      const created = await as(cookie, "POST", "/v1/admin/responder/deployments", {
        ...base,
        label,
        visibility,
      });
      expect(created.statusCode).toBe(201);
    }
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/map/presence?bbox=3.2,6.4,3.6,6.7",
    });
    const presence = response.json().presence as Array<{ label: string; cell: string }>;
    expect(presence.map((p) => p.label).sort()).toEqual(["Area", "Street"]);
    expect(JSON.stringify(presence)).not.toContain(String(LAGOS.lat));
    // "Area" uses a much larger cell than "Street".
    const resolution = (cell: string) => Number.parseInt(cell[1] ?? "0", 16);
    const street = presence.find((p) => p.label === "Street");
    const area = presence.find((p) => p.label === "Area");
    expect(resolution(street?.cell ?? "")).toBe(9);
    expect(resolution(area?.cell ?? "")).toBe(7);

    // Other organisations see all but hidden ones; the public sees nothing once they end.
    const other = await signInResponder(ctx, { name: "Lagos Ambulance" });
    const list = await as(other.cookie, "GET", "/v1/admin/responder/deployments");
    expect((list.json().items as Array<{ label: string }>).map((d) => d.label).sort()).toEqual([
      "Area",
      "Responders",
      "Street",
    ]);
    ctx.advance(61 * MINUTE);
    const later = await ctx.app.inject({
      method: "GET",
      url: "/v1/map/presence?bbox=3.2,6.4,3.6,6.7",
    });
    expect(later.json().presence).toHaveLength(0);
  });

  it("refuses deployments outside the organisation's area", async () => {
    const { cookie } = await signInResponder(ctx);
    const response = await as(cookie, "POST", "/v1/admin/responder/deployments", {
      label: "Far away",
      kind: "patrol",
      visibility: "public_area",
      location: ABUJA,
      durationMinutes: 60,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("broadcasts", () => {
  it("signs broadcasts and delivers them through the alert feed", async () => {
    const { cookie } = await signInResponder(ctx, { name: "Lagos State Emergency" });
    const response = await as(cookie, "POST", "/v1/admin/responder/broadcasts", {
      tier: "warning",
      message: "Flooding on Third Mainland Bridge. Avoid the area.",
      center: LAGOS,
      radiusM: 15_000,
      expiresInMinutes: 120,
    });
    expect(response.statusCode).toBe(201);
    const broadcast = response.json() as SignedBroadcast;

    const seed = ctx.config.signingKey?.seed;
    if (!seed) throw new Error("test signing key missing");
    const publicKey = new Signer(seed, "s1").publicKey;
    const key = createPublicKey({
      key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), publicKey]),
      format: "der",
      type: "spki",
    });
    const signed = Buffer.from(broadcastSigningText(broadcast));
    expect(verify(null, signed, key, Buffer.from(broadcast.signature, "base64"))).toBe(true);
    const tampered = Buffer.from(broadcastSigningText({ ...broadcast, message: "All clear" }));
    expect(verify(null, tampered, key, Buffer.from(broadcast.signature, "base64"))).toBe(false);

    ctx.advance(10_000);
    const feed = await ctx.app.inject({
      method: "GET",
      url: `/v1/alerts?tiles=${tilesAround(LAGOS.lat, LAGOS.lng).join(",")}`,
    });
    const alerts = feed.json().alerts as Array<{ kind: string; broadcast: SignedBroadcast }>;
    // One per tile asked for, all the same broadcast.
    expect(alerts.length).toBeGreaterThan(1);
    expect(new Set(alerts.map((a) => a.broadcast.id))).toEqual(new Set([broadcast.id]));
    expect(alerts[0]).toMatchObject({ kind: "broadcast", source: "Lagos State Emergency" });
    expect(alerts[0]?.broadcast.signature).toBe(broadcast.signature);

    await as(cookie, "POST", `/v1/admin/responder/broadcasts/${broadcast.id}/withdraw`, {});
    const after = await ctx.app.inject({
      method: "GET",
      url: `/v1/alerts?tiles=${tilesAround(LAGOS.lat, LAGOS.lng).join(",")}`,
    });
    expect(after.json().alerts).toHaveLength(0);
  });

  it("refuses broadcasts outside the organisation's area", async () => {
    const { cookie } = await signInResponder(ctx);
    const response = await as(cookie, "POST", "/v1/admin/responder/broadcasts", {
      tier: "advisory",
      message: "This should not go out at all.",
      center: ABUJA,
      radiusM: 1_000,
      expiresInMinutes: 60,
    });
    expect(response.statusCode).toBe(403);
  });
});

describe("SOS board", () => {
  async function startSos(share: boolean, location = LAGOS) {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { "x-warden-install": randomUUID() },
      payload: { kind: "sos", personName: share ? "Ada" : "Bola", shareWithResponders: share },
    });
    const sos = response.json() as { sessionId: string; controlToken: string };
    await ctx.app.inject({
      method: "POST",
      url: `/v1/sessions/${sos.sessionId}/points`,
      headers: { "x-warden-session-control": sos.controlToken },
      payload: { points: [{ ...location, accuracyM: 20, at: ctx.now().toISOString() }] },
    });
    return sos;
  }

  it("shows only SOS sessions shared with responders in the area, and audits each view", async () => {
    await startSos(true);
    await startSos(false);
    await startSos(true, ABUJA);
    const { cookie, organisationId } = await signInResponder(ctx);
    const board = await as(cookie, "GET", "/v1/admin/responder/sos");
    const items = board.json().items as Array<{ personName: string; lastPoint: unknown }>;
    expect(items.map((i) => i.personName)).toEqual(["Ada"]);
    expect(items[0]?.lastPoint).toMatchObject({ lat: LAGOS.lat, lng: LAGOS.lng });
    const { rows } = await ctx.pool.query(
      "SELECT 1 FROM audit_events WHERE action = 'sos.board_viewed' AND object_id = $1",
      [organisationId],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("USSD", () => {
  const SECRET = "ussd-test-secret-0123456789abcdef";

  function dial(text: string, phone = "+2348031234567", sessionId = "ATUid_1") {
    return ctx.app.inject({
      method: "POST",
      url: `/v1/ussd/${SECRET}`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: new URLSearchParams({
        sessionId,
        serviceCode: "*384*123#",
        phoneNumber: phone,
        text,
      }).toString(),
    });
  }

  it("walks the menu from the text typed so far", () => {
    expect(ussdStep("")).toMatchObject({ text: expect.stringMatching(/^CON Warden safety/) });
    expect(ussdStep("2")).toMatchObject({
      text: expect.stringMatching(/^END Emergency: call 112/),
    });
    const page1 = ussdStep("1*1");
    expect(page1).toMatchObject({ text: expect.stringContaining("9. More") });
    expect(ussdStep("1*1*9")).toMatchObject({ text: expect.stringContaining("3. Ikeja") });
    expect(ussdStep("1*1*9*3*1*1")).toMatchObject({
      kind: "submit",
      categoryId: "armed_robbery",
      area: { name: "Ikeja" },
    });
    expect(ussdStep("1*2*1*4")).toMatchObject({
      text: expect.stringContaining("Fire in Abuja Municipal"),
    });
    expect(ussdStep("1*2*1*4*2")).toMatchObject({ text: "END Cancelled. Nothing was sent." });
    expect(ussdStep("7")).toMatchObject({ text: expect.stringMatching(/^END That choice/) });
    expect(ussdStep("1*1*1*1*1*1")).toMatchObject({
      text: expect.stringMatching(/^END That choice/),
    });
  });

  it("files a held report at the area's centre, once per session, without storing the number", async () => {
    const first = await dial("1*1*9*3*1*1");
    expect(first.headers["content-type"]).toContain("text/plain");
    expect(first.body).toMatch(/^END Thank you/);
    await dial("1*1*9*3*1*1"); // the provider retries the same step
    const { rows } = await ctx.pool.query(
      "SELECT r.channel, i.state, i.public_cell FROM reports r JOIN incidents i ON i.id = r.incident_id",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "ussd", state: "held" });
    expect(Number.parseInt(rows[0].public_cell[1], 16)).toBe(7);

    const everything =
      JSON.stringify((await ctx.pool.query("SELECT * FROM reports")).rows) + ctx.logs.join("\n");
    expect(everything).not.toContain("8031234567");
    expect(ctx.logs.join("\n")).not.toContain(SECRET);
    expect((await mapAround(ctx)).incidents).toHaveLength(0);
  });

  it("rejects a wrong secret and limits reports per caller", async () => {
    const wrong = await ctx.app.inject({
      method: "POST",
      url: "/v1/ussd/not-the-secret-at-all-000000",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "sessionId=x&phoneNumber=%2B2348031234567&text=",
    });
    expect(wrong.statusCode).toBe(404);
    const bodies: string[] = [];
    for (let i = 0; i < 6; i += 1) bodies.push((await dial("1*1*1*4*1", undefined, `S${i}`)).body);
    expect(bodies.slice(0, 5).every((b) => b.startsWith("END Thank you"))).toBe(true);
    expect(bodies[5]).toMatch(/several reports already/);
  });
});
