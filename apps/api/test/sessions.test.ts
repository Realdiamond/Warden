import { randomUUID } from "node:crypto";
import { normalizeNigerianPhone, parseViewFragment } from "@warden/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runSessionHousekeeping } from "../src/services/sessions.ts";
import { deliverDueSms, SMS_PER_NUMBER_PER_DAY } from "../src/services/sms.ts";
import { createTestContext, LAGOS, serviceDeps, type TestContext } from "./helpers.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const MINUTE = 60_000;
const CONTACTS = [
  { name: "Mum", phone: "0803 123 4567" },
  { name: "Tunde", phone: "+2348091234567" },
];

interface Receipt {
  sessionId: string;
  viewToken: string;
  controlToken: string;
  viewUrl: string | null;
}

async function start(body: Record<string, unknown>, install = randomUUID()) {
  return ctx.app.inject({
    method: "POST",
    url: "/v1/sessions",
    headers: { "x-warden-install": install },
    payload: body,
  });
}

async function startTrip(minutes = 30): Promise<Receipt> {
  const response = await start({
    kind: "trip",
    personName: "Ada",
    contacts: CONTACTS,
    destination: { lat: 6.45, lng: 3.4, label: "Lekki" },
    expectedArrivalAt: new Date(ctx.now().getTime() + minutes * MINUTE).toISOString(),
    note: "Blue Toyota, plate KJA 123 XY",
  });
  expect(response.statusCode).toBe(201);
  return response.json() as Receipt;
}

function control(receipt: Receipt, action: string, payload: Record<string, unknown>) {
  return ctx.app.inject({
    method: "POST",
    url: `/v1/sessions/${receipt.sessionId}/${action}`,
    headers: { "x-warden-session-control": receipt.controlToken },
    payload,
  });
}

async function view(receipt: Receipt, token = receipt.viewToken) {
  return ctx.app.inject({
    method: "GET",
    url: `/v1/sessions/${receipt.sessionId}/view`,
    headers: { "x-warden-session-view": token },
  });
}

async function deliver() {
  return deliverDueSms(serviceDeps(ctx));
}

describe("trip sharing", () => {
  it("shares a live location with holders of the link only", async () => {
    const trip = await startTrip();
    expect(trip.viewUrl).toBe(`https://warden.test/live#${trip.sessionId}.${trip.viewToken}`);
    expect(parseViewFragment(`#${trip.sessionId}.${trip.viewToken}`)).toEqual({
      sessionId: trip.sessionId,
      viewToken: trip.viewToken,
    });

    const at = ctx.now().toISOString();
    const points = await control(trip, "points", {
      points: [{ ...LAGOS, accuracyM: 12, at, battery: 64 }],
    });
    expect(points.json()).toEqual({ accepted: 1, state: "active" });

    const response = await view(trip);
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toMatchObject({
      kind: "trip",
      state: "active",
      alarm: false,
      personName: "Ada",
      note: "Blue Toyota, plate KJA 123 XY",
      destination: { label: "Lekki" },
      lastPoint: { lat: LAGOS.lat, lng: LAGOS.lng, accuracyM: 12, battery: 64 },
      track: [[LAGOS.lng, LAGOS.lat]],
    });

    // A wrong token, the control token, or a made-up id all look the same.
    expect((await view(trip, "x".repeat(43))).statusCode).toBe(404);
    expect((await view(trip, trip.controlToken)).statusCode).toBe(404);
    const unknown = { ...trip, sessionId: randomUUID() };
    expect((await view(unknown)).statusCode).toBe(404);
    // The view token cannot control the session.
    const hijack = await control({ ...trip, controlToken: trip.viewToken }, "end", {
      outcome: "arrived",
    });
    expect(hijack.statusCode).toBe(404);
  });

  it("stores names, notes, numbers and locations only as ciphertext", async () => {
    const trip = await startTrip();
    await control(trip, "points", { points: [{ ...LAGOS, at: ctx.now().toISOString() }] });
    const { rows } = await ctx.pool.query(
      "SELECT details_enc, view_token_enc FROM safety_sessions",
    );
    const points = await ctx.pool.query("SELECT point_enc FROM session_points");
    const raw = Buffer.concat([
      rows[0].details_enc,
      rows[0].view_token_enc,
      points.rows[0].point_enc,
    ]).toString("latin1");
    for (const secret of ["Ada", "Toyota", "8031234567", "6.5244", trip.viewToken]) {
      expect(raw).not.toContain(secret);
    }
  });

  it("tells contacts when a trip is overdue, and again when it ends", async () => {
    const trip = await startTrip(20);
    ctx.advance(25 * MINUTE);
    expect((await runSessionHousekeeping(serviceDeps(ctx))).overdue).toBe(0);
    ctx.advance(10 * MINUTE);
    expect((await runSessionHousekeeping(serviceDeps(ctx))).overdue).toBe(1);
    await deliver();
    expect(ctx.sms.sent.map((m) => m.to).sort()).toEqual(["+2348031234567", "+2348091234567"]);
    expect(ctx.sms.sent[0]?.text).toContain("Ada has not arrived at Lekki");
    expect(ctx.sms.sent[0]?.text).toContain(trip.viewUrl);
    expect((await view(trip)).json()).toMatchObject({ state: "overdue", alarm: true });

    // Running again does not message twice.
    await runSessionHousekeeping(serviceDeps(ctx));
    await deliver();
    expect(ctx.sms.sent).toHaveLength(2);

    await control(trip, "end", { outcome: "arrived" });
    await deliver();
    expect(ctx.sms.sent.at(-1)?.text).toBe("Warden: Ada has arrived safely.");
    expect((await view(trip)).json()).toMatchObject({ state: "ended", outcome: "arrived" });
  });

  it("sends nothing when a trip ends on time", async () => {
    const trip = await startTrip();
    await control(trip, "end", { outcome: "arrived" });
    await deliver();
    expect(ctx.sms.sent).toHaveLength(0);
    expect(
      (await control(trip, "points", { points: [{ ...LAGOS, at: ctx.now().toISOString() }] }))
        .statusCode,
    ).toBe(409);
  });

  it("lets the traveller add time, which clears an overdue state", async () => {
    const trip = await startTrip(10);
    ctx.advance(25 * MINUTE);
    await runSessionHousekeeping(serviceDeps(ctx));
    const extended = await control(trip, "extend", { minutes: 30 });
    expect(extended.statusCode).toBe(200);
    expect((await view(trip)).json()).toMatchObject({ state: "active", alarm: false });
    await deliver();
    expect(ctx.sms.sent.at(-1)?.text).toBe("Warden: Ada added 30 minutes to their trip.");
  });

  it("drops points from outside the session's time", async () => {
    const trip = await startTrip();
    const old = new Date(ctx.now().getTime() - 60 * MINUTE).toISOString();
    const future = new Date(ctx.now().getTime() + 60 * MINUTE).toISOString();
    const response = await control(trip, "points", {
      points: [
        { ...LAGOS, at: old },
        { ...LAGOS, at: future },
      ],
    });
    expect(response.json()).toEqual({ accepted: 0, state: "active" });
  });

  it("deletes everything two days after the session ends", async () => {
    const trip = await startTrip();
    await control(trip, "points", { points: [{ ...LAGOS, at: ctx.now().toISOString() }] });
    await control(trip, "end", { outcome: "arrived" });
    ctx.advance(49 * 60 * MINUTE);
    expect((await runSessionHousekeeping(serviceDeps(ctx))).deleted).toBe(1);
    const counts = await ctx.pool.query(
      `SELECT (SELECT count(*) FROM safety_sessions)::int AS s,
              (SELECT count(*) FROM session_points)::int AS p`,
    );
    expect(counts.rows[0]).toEqual({ s: 0, p: 0 });
    expect((await view(trip)).statusCode).toBe(404);
  });

  it("validates trips", async () => {
    const base = { kind: "trip", personName: "Ada" };
    expect((await start(base)).statusCode).toBe(400);
    const tooFar = new Date(ctx.now().getTime() + 13 * 3_600_000).toISOString();
    expect((await start({ ...base, expectedArrivalAt: tooFar })).statusCode).toBe(400);
    const badPhone = { ...base, expectedArrivalAt: tooFar, contacts: [{ name: "X", phone: "12" }] };
    expect((await start(badPhone)).statusCode).toBe(400);
    const abroad = {
      ...base,
      expectedArrivalAt: new Date(ctx.now().getTime() + MINUTE * 30).toISOString(),
      destination: { lat: 51.5, lng: -0.12 },
    };
    expect((await start(abroad)).statusCode).toBe(400);
  });
});

describe("SOS", () => {
  it("messages every contact straight away, with the live link", async () => {
    const response = await start({ kind: "sos", personName: "Ada", contacts: CONTACTS });
    expect(response.statusCode).toBe(201);
    const sos = response.json() as Receipt;
    await deliver();
    expect(ctx.sms.sent).toHaveLength(2);
    expect(ctx.sms.sent[0]?.text).toMatch(
      /^Warden SOS: Ada needs help now\. Live location: https:\/\/warden\.test\/live#/,
    );
    expect((await view(sos)).json()).toMatchObject({ kind: "sos", alarm: true });

    await control(sos, "end", { outcome: "safe" });
    await deliver();
    expect(ctx.sms.sent.at(-1)?.text).toBe("Warden: Ada says they are safe now.");
  });

  it("with the duress PIN, looks stopped on the phone but keeps contacts alarmed", async () => {
    const trip = await startTrip();
    const ended = await control(trip, "end", { outcome: "cancelled", duress: true });
    expect(ended.json()).toEqual({ ended: true });
    const normal = await control(await startTrip(), "end", { outcome: "cancelled" });
    expect(normal.json()).toEqual(ended.json());

    await deliver();
    const duress = ctx.sms.sent.filter((m) =>
      m.text.startsWith("Warden URGENT: Ada may be in danger"),
    );
    expect(duress).toHaveLength(2);
    expect((await view(trip)).json()).toMatchObject({ state: "active", alarm: true, duress: true });
    // The phone can still send its location after a duress stop.
    const points = await control(trip, "points", {
      points: [{ ...LAGOS, at: ctx.now().toISOString() }],
    });
    expect(points.statusCode).toBe(200);
  });

  it("retries failed messages and caps messages per number", async () => {
    ctx.sms.failNext = 2;
    await start({ kind: "sos", personName: "Ada", contacts: [CONTACTS[0]] });
    await deliver();
    expect(ctx.sms.sent).toHaveLength(0);
    ctx.advance(MINUTE);
    await deliver();
    expect(ctx.sms.sent).toHaveLength(0);
    ctx.advance(3 * MINUTE);
    await deliver();
    expect(ctx.sms.sent).toHaveLength(1);

    for (let i = 0; i < SMS_PER_NUMBER_PER_DAY + 3; i += 1) {
      await start({ kind: "sos", personName: "Spam", contacts: [CONTACTS[0]] });
    }
    const { rows } = await ctx.pool.query("SELECT count(*)::int AS n FROM sms_outbox");
    expect(rows[0].n).toBe(SMS_PER_NUMBER_PER_DAY);
  });

  it("rate-limits starts per phone and never logs numbers or names", async () => {
    const install = randomUUID();
    const codes: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      codes.push(
        (await start({ kind: "sos", personName: "Ada", contacts: CONTACTS }, install)).statusCode,
      );
    }
    expect(codes.slice(0, 6).every((code) => code === 201)).toBe(true);
    expect(codes[6]).toBe(429);
    await deliver();
    const logs = ctx.logs.join("\n");
    for (const secret of ["8031234567", "Ada", install]) expect(logs).not.toContain(secret);
  });
});

describe("phone numbers", () => {
  it("normalises Nigerian mobile numbers", () => {
    expect(normalizeNigerianPhone("0803 123 4567")).toBe("+2348031234567");
    expect(normalizeNigerianPhone("234-809-123-4567")).toBe("+2348091234567");
    expect(normalizeNigerianPhone("+2347011234567")).toBe("+2347011234567");
    expect(normalizeNigerianPhone("01 234 5678")).toBeNull();
    expect(normalizeNigerianPhone("+447700900123")).toBeNull();
  });
});
