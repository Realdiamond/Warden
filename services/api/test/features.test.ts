import { test } from "node:test";
import assert from "node:assert/strict";

// Fixed secrets + in-memory DB, set before importing anything that reads config.
process.env.ANDSV_DB = ":memory:";
process.env.ANDSV_JWT_SECRET = "test-secret-value-test-secret-value";
process.env.ANDSV_ENCRYPTION_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const { buildServer } = await import("../src/server.ts");
const app = await buildServer();

/** Sign up, create a device, pair it with consent. Returns the tokens/ids. */
async function setup() {
  const email = `p${Math.random().toString(36).slice(2)}@example.com`;
  const signup = await app.inject({ method: "POST", url: "/v1/accounts", payload: { email, password: "supersecret" } });
  const accountToken = signup.json().token as string;
  const created = await app.inject({
    method: "POST",
    url: "/v1/devices",
    headers: { authorization: `Bearer ${accountToken}` },
    payload: { name: "Kid phone" },
  });
  const { deviceId, pairCode } = created.json() as { deviceId: string; pairCode: string };
  const paired = await app.inject({
    method: "POST",
    url: "/v1/pairing",
    payload: { pairCode, deviceName: "Kid phone", platform: "android", appVersion: "0.4.0", consentAcceptedAt: new Date().toISOString() },
  });
  const deviceToken = paired.json().deviceToken as string;
  return { accountToken, deviceId, deviceToken };
}

function ev(deviceToken: string, body: unknown) {
  return app.inject({ method: "POST", url: "/v1/events", headers: { authorization: `Bearer ${deviceToken}` }, payload: body as object });
}

async function readEvents(accountToken: string, deviceId: string, kind?: string) {
  const res = await app.inject({
    method: "GET",
    url: `/v1/devices/${deviceId}/events${kind ? `?kind=${kind}` : ""}`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  return res.json().events as { id: string; kind: string; payload: Record<string, unknown> }[];
}

// --- Offline sync: de-duplication ------------------------------------------

test("same clientId is stored once, even re-sent many times", async () => {
  const { accountToken, deviceId, deviceToken } = await setup();
  const payload = { kind: "message", capturedAt: new Date().toISOString(), payload: { app: "WhatsApp", text: "hi", conversation: "Jake" }, clientId: "dup-1" };
  const a = await ev(deviceToken, payload);
  const b = await ev(deviceToken, payload);
  const c = await ev(deviceToken, payload);
  assert.equal(a.statusCode, 201);
  assert.equal(b.json().deduped, true);
  assert.equal(c.json().deduped, true);
  // all three returned the same stored id
  assert.equal(a.json().id, b.json().id);
  const events = await readEvents(accountToken, deviceId, "message");
  assert.equal(events.length, 1);
});

// --- Offline sync: batch flush ---------------------------------------------

test("batch flush stores all events, and re-flushing the same batch stores nothing new", async () => {
  const { accountToken, deviceId, deviceToken } = await setup();
  const base = Date.now();
  const batch = {
    events: [
      { kind: "message", capturedAt: new Date(base).toISOString(), payload: { app: "WhatsApp", text: "one", conversation: "Jake" }, clientId: "b1" },
      { kind: "call", capturedAt: new Date(base + 1).toISOString(), payload: { number: "+1 647-555-0192", name: "Jake", direction: "in", durationSec: 30 }, clientId: "b2" },
      { kind: "location", capturedAt: new Date(base + 2).toISOString(), payload: { lat: 6.5, lon: 3.3 }, clientId: "b3" },
      { kind: "status", capturedAt: new Date(base + 3).toISOString(), payload: { appVersion: "0.4.0" }, clientId: "b4" },
    ],
  };
  const first = await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${deviceToken}` }, payload: batch });
  assert.equal(first.statusCode, 201);
  assert.equal(first.json().accepted, 4);
  assert.equal(first.json().stored, 4);

  const again = await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${deviceToken}` }, payload: batch });
  assert.equal(again.json().accepted, 4);
  assert.equal(again.json().stored, 0); // all de-duplicated

  const all = await readEvents(accountToken, deviceId);
  assert.equal(all.length, 4); // not 8
});

test("partial re-delivery: a batch mixing already-sent and new events stores only the new ones", async () => {
  const { accountToken, deviceId, deviceToken } = await setup();
  const t = (n: number) => new Date(Date.now() + n).toISOString();
  const first = {
    events: [
      { kind: "message", capturedAt: t(1), payload: { app: "WhatsApp", text: "a", conversation: "X" }, clientId: "p1" },
      { kind: "message", capturedAt: t(2), payload: { app: "WhatsApp", text: "b", conversation: "X" }, clientId: "p2" },
    ],
  };
  await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${deviceToken}` }, payload: first });
  // second flush re-includes p2 (server didn't confirm before a retry) plus a new p3
  const second = {
    events: [
      { kind: "message", capturedAt: t(2), payload: { app: "WhatsApp", text: "b", conversation: "X" }, clientId: "p2" },
      { kind: "message", capturedAt: t(3), payload: { app: "WhatsApp", text: "c", conversation: "X" }, clientId: "p3" },
    ],
  };
  const res = await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${deviceToken}` }, payload: second });
  assert.equal(res.json().accepted, 2);
  assert.equal(res.json().stored, 1); // only p3 is new
  const all = await readEvents(accountToken, deviceId, "message");
  assert.equal(all.length, 3); // a, b, c — no duplicate b
});

test("batch skips an unknown kind but stores the valid events", async () => {
  const { accountToken, deviceId, deviceToken } = await setup();
  const res = await app.inject({
    method: "POST",
    url: "/v1/events/batch",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: {
      events: [
        { kind: "message", capturedAt: new Date().toISOString(), payload: { app: "WhatsApp", text: "ok", conversation: "X" }, clientId: "k1" },
        { kind: "bogus", capturedAt: new Date().toISOString(), payload: {}, clientId: "k2" },
      ],
    },
  });
  assert.equal(res.json().stored, 1);
  const all = await readEvents(accountToken, deviceId);
  assert.equal(all.length, 1);
});

test("an event without a clientId is still stored (clientId is optional)", async () => {
  const { accountToken, deviceId, deviceToken } = await setup();
  const res = await ev(deviceToken, { kind: "message", capturedAt: new Date().toISOString(), payload: { app: "WhatsApp", text: "no id", conversation: "X" } });
  assert.equal(res.statusCode, 201);
  assert.equal((await readEvents(accountToken, deviceId, "message")).length, 1);
});

test("batch is rejected for a bad device token", async () => {
  const res = await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: "Bearer nope" }, payload: { events: [{ kind: "status", capturedAt: new Date().toISOString(), payload: {} }] } });
  assert.equal(res.statusCode, 401);
});

// --- Watchlist: term CRUD ---------------------------------------------------

test("watch terms: add, list, case-insensitive de-dup, delete", async () => {
  const { accountToken, deviceId } = await setup();
  const add = (term: string) =>
    app.inject({ method: "POST", url: `/v1/devices/${deviceId}/watch-terms`, headers: { authorization: `Bearer ${accountToken}` }, payload: { term } });

  const a = await add("Money");
  assert.equal(a.statusCode, 201);
  const dup = await add("money"); // same term, different case
  assert.equal(dup.statusCode, 200);
  assert.equal(dup.json().term.id, a.json().term.id);

  await add("Jake");
  const list = await app.inject({ method: "GET", url: `/v1/devices/${deviceId}/watch-terms`, headers: { authorization: `Bearer ${accountToken}` } });
  assert.equal(list.json().terms.length, 2);

  const del = await app.inject({ method: "DELETE", url: `/v1/devices/${deviceId}/watch-terms/${a.json().term.id}`, headers: { authorization: `Bearer ${accountToken}` } });
  assert.equal(del.statusCode, 200);
  const list2 = await app.inject({ method: "GET", url: `/v1/devices/${deviceId}/watch-terms`, headers: { authorization: `Bearer ${accountToken}` } });
  assert.equal(list2.json().terms.length, 1);
});

// --- Watchlist: matching + grouping ----------------------------------------

test("watch matches: keyword (incl. inside a word), grouped per chat; number and name too", async () => {
  const { accountToken, deviceId, deviceToken } = await setup();
  const t = (n: number) => new Date(Date.now() + n).toISOString();
  const seed = [
    { kind: "message", capturedAt: t(1), payload: { app: "WhatsApp", conversation: "Jake M.", text: "send the money tonight", direction: "in" }, clientId: "m1" },
    { kind: "message", capturedAt: t(2), payload: { app: "WhatsApp", conversation: "Jake M.", text: "i don't have money", direction: "out" }, clientId: "m2" },
    { kind: "message", capturedAt: t(3), payload: { app: "Snapchat", conversation: "deekay_07", text: "use moneygram its faster", direction: "in" }, clientId: "m3" },
    { kind: "message", capturedAt: t(4), payload: { app: "WhatsApp", conversation: "Mom", text: "hello there", direction: "in" }, clientId: "m4" },
    { kind: "call", capturedAt: t(5), payload: { number: "+1 647-555-0192", name: "Jake M.", direction: "in", durationSec: 44 }, clientId: "c1" },
  ];
  await app.inject({ method: "POST", url: "/v1/events/batch", headers: { authorization: `Bearer ${deviceToken}` }, payload: { events: seed } });

  const matches = (term: string) =>
    app.inject({ method: "GET", url: `/v1/devices/${deviceId}/watch-matches?term=${encodeURIComponent(term)}`, headers: { authorization: `Bearer ${accountToken}` } });

  // keyword "money" — 3 message hits (incl. "moneygram"), in 2 chats
  const money = (await matches("money")).json();
  assert.equal(money.totalMatches, 3, "money should hit 3 messages incl. moneygram");
  assert.equal(money.groups.length, 2, "grouped into 2 chats");
  const snap = money.groups.find((g: { title: string }) => g.title === "deekay_07");
  assert.ok(snap, "deekay_07 group present (inside-word match)");

  // number term — digits match the formatted call number
  const num = (await matches("6475550192")).json();
  assert.equal(num.totalMatches, 1);
  assert.equal(num.groups[0].kind, "call");

  // name term — catches both the chat (conversation) and the call (name)
  const jake = (await matches("jake")).json();
  assert.equal(jake.totalMatches, 3); // 2 Jake messages + 1 Jake call
});
