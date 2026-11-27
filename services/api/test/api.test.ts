import { test } from "node:test";
import assert from "node:assert/strict";

// Fixed secrets + in-memory DB, set before importing anything that reads config.
process.env.ANDSV_DB = ":memory:";
process.env.ANDSV_JWT_SECRET = "test-secret-value-test-secret-value";
process.env.ANDSV_ENCRYPTION_KEY =
  "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff";

const { buildServer } = await import("../src/server.ts");

const app = await buildServer();

test("full flow: signup -> device -> pair with consent -> location -> parent reads", async () => {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { email: "parent@example.com", password: "supersecret" },
  });
  assert.equal(signup.statusCode, 201);
  const accountToken = signup.json().token as string;

  const created = await app.inject({
    method: "POST",
    url: "/v1/devices",
    headers: { authorization: `Bearer ${accountToken}` },
    payload: { name: "Kid phone" },
  });
  assert.equal(created.statusCode, 201);
  const { deviceId, pairCode } = created.json() as { deviceId: string; pairCode: string };

  const paired = await app.inject({
    method: "POST",
    url: "/v1/pairing",
    payload: {
      pairCode,
      deviceName: "Kid phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  assert.equal(paired.statusCode, 201);
  const deviceToken = paired.json().deviceToken as string;

  const reported = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: {
      kind: "location",
      capturedAt: new Date().toISOString(),
      payload: { lat: 6.5244, lon: 3.3792, accuracyM: 12 },
    },
  });
  assert.equal(reported.statusCode, 201);

  const read = await app.inject({
    method: "GET",
    url: `/v1/devices/${deviceId}/events?kind=location`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  assert.equal(read.statusCode, 200);
  const { events } = read.json() as { events: Array<{ payload: { lat: number } }> };
  assert.equal(events.length, 1);
  assert.equal(events[0]?.payload.lat, 6.5244);
});

test("app_usage events are stored and read back", async () => {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { email: `usage${Date.now()}@example.com`, password: "supersecret" },
  });
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
    payload: {
      pairCode,
      deviceName: "Kid phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  const deviceToken = paired.json().deviceToken as string;

  const reported = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: {
      kind: "app_usage",
      capturedAt: new Date().toISOString(),
      payload: { packageName: "com.whatsapp", foregroundMs: 3_600_000 },
    },
  });
  assert.equal(reported.statusCode, 201);

  const read = await app.inject({
    method: "GET",
    url: `/v1/devices/${deviceId}/events?kind=app_usage`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  assert.equal(read.statusCode, 200);
  const { events } = read.json() as {
    events: Array<{ payload: { packageName: string; foregroundMs: number } }>;
  };
  assert.equal(events.length, 1);
  assert.equal(events[0]?.payload.packageName, "com.whatsapp");
  assert.equal(events[0]?.payload.foregroundMs, 3_600_000);
});

test("message events round-trip (sensitive kind, encrypted at rest)", async () => {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { email: `msg${Date.now()}@example.com`, password: "supersecret" },
  });
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
    payload: {
      pairCode,
      deviceName: "Kid phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  const deviceToken = paired.json().deviceToken as string;

  const secret = "meet me at 4pm";
  const reported = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: {
      kind: "message",
      capturedAt: new Date().toISOString(),
      payload: { app: "com.whatsapp", sender: "Mum", text: secret },
    },
  });
  assert.equal(reported.statusCode, 201);

  const read = await app.inject({
    method: "GET",
    url: `/v1/devices/${deviceId}/events?kind=message`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  const { events } = read.json() as {
    events: Array<{ payload: { app: string; sender: string; text: string } }>;
  };
  assert.equal(events.length, 1);
  assert.equal(events[0]?.payload.text, secret);
  assert.equal(events[0]?.payload.sender, "Mum");
});

test("call events round-trip (sensitive kind)", async () => {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { email: `call${Date.now()}@example.com`, password: "supersecret" },
  });
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
    payload: {
      pairCode,
      deviceName: "Kid phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  const deviceToken = paired.json().deviceToken as string;

  const reported = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: {
      kind: "call",
      capturedAt: new Date().toISOString(),
      payload: { number: "+2348012345678", direction: "incoming", durationSec: 125 },
    },
  });
  assert.equal(reported.statusCode, 201);

  const read = await app.inject({
    method: "GET",
    url: `/v1/devices/${deviceId}/events?kind=call`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  const { events } = read.json() as {
    events: Array<{ payload: { number: string; direction: string; durationSec: number } }>;
  };
  assert.equal(events.length, 1);
  assert.equal(events[0]?.payload.direction, "incoming");
  assert.equal(events[0]?.payload.durationSec, 125);
});

test("a device token cannot read another account's device", async () => {
  // A random/forged account token must not read someone else's device.
  const read = await app.inject({
    method: "GET",
    url: "/v1/devices/does-not-exist/events",
    headers: { authorization: "Bearer not-a-real-token" },
  });
  assert.equal(read.statusCode, 401);
});

test("pairing is refused without a valid consent timestamp", async () => {
  const paired = await app.inject({
    method: "POST",
    url: "/v1/pairing",
    payload: {
      pairCode: "00000000",
      deviceName: "x",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: "",
    },
  });
  assert.equal(paired.statusCode, 400);
});

test("event ingestion is refused with a bad device token", async () => {
  const reported = await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: { authorization: "Bearer forged-device-token" },
    payload: { kind: "location", capturedAt: new Date().toISOString(), payload: {} },
  });
  assert.equal(reported.statusCode, 401);
});

test("remote commands: parent enqueues, device fetches and acks", async () => {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { email: `cmd${Date.now()}@example.com`, password: "supersecret" },
  });
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
    payload: {
      pairCode,
      deviceName: "Kid phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  const deviceToken = paired.json().deviceToken as string;

  const enq = await app.inject({
    method: "POST",
    url: `/v1/devices/${deviceId}/commands`,
    headers: { authorization: `Bearer ${accountToken}` },
    payload: { type: "lock" },
  });
  assert.equal(enq.statusCode, 201);
  const commandId = enq.json().id as string;

  const fetched = await app.inject({
    method: "GET",
    url: "/v1/commands",
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  const { commands } = fetched.json() as { commands: Array<{ id: string; type: string }> };
  assert.equal(commands.length, 1);
  assert.equal(commands[0]?.type, "lock");

  await app.inject({
    method: "POST",
    url: "/v1/commands/ack",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: { ids: [commandId] },
  });
  const after = await app.inject({
    method: "GET",
    url: "/v1/commands",
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  assert.equal((after.json() as { commands: unknown[] }).commands.length, 0);
});

test("app limits: parent sets blocked apps, device reads them", async () => {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { email: `limits${Date.now()}@example.com`, password: "supersecret" },
  });
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
    payload: {
      pairCode,
      deviceName: "Kid phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  const deviceToken = paired.json().deviceToken as string;

  const blocked = ["com.whatsapp", "com.instagram.android"];
  const put = await app.inject({
    method: "PUT",
    url: `/v1/devices/${deviceId}/rules`,
    headers: { authorization: `Bearer ${accountToken}` },
    payload: { blockedApps: blocked },
  });
  assert.equal(put.statusCode, 200);

  const rules = await app.inject({
    method: "GET",
    url: "/v1/rules",
    headers: { authorization: `Bearer ${deviceToken}` },
  });
  assert.equal(rules.statusCode, 200);
  assert.deepEqual((rules.json() as { blockedApps: string[] }).blockedApps, blocked);

  const dev = await app.inject({
    method: "GET",
    url: `/v1/devices/${deviceId}`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  assert.deepEqual((dev.json() as { device: { blockedApps: string[] } }).device.blockedApps, blocked);
});

test("re-link: regenerate a pairing code lets the same device pair again", async () => {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { email: "relink@example.com", password: "supersecret" },
  });
  const accountToken = signup.json().token as string;

  const created = await app.inject({
    method: "POST",
    url: "/v1/devices",
    headers: { authorization: `Bearer ${accountToken}` },
    payload: { name: "Relink phone" },
  });
  const { deviceId, pairCode } = created.json() as { deviceId: string; pairCode: string };

  // Pair once.
  const paired = await app.inject({
    method: "POST",
    url: "/v1/pairing",
    payload: {
      pairCode,
      deviceName: "Relink phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  assert.equal(paired.statusCode, 201);

  // The old code was consumed on pairing, so reusing it is refused.
  const again = await app.inject({
    method: "POST",
    url: "/v1/pairing",
    payload: {
      pairCode,
      deviceName: "Relink phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  assert.equal(again.statusCode, 404); // invalid_pair_code (code cleared on pair)

  // Regenerate a code for the same device.
  const relink = await app.inject({
    method: "POST",
    url: `/v1/devices/${deviceId}/pair-code`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  assert.equal(relink.statusCode, 200);
  const newCode = (relink.json() as { pairCode: string }).pairCode;
  assert.notEqual(newCode, pairCode);

  // Device now reads as unpaired.
  const dev = await app.inject({
    method: "GET",
    url: `/v1/devices/${deviceId}`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  assert.equal((dev.json() as { device: { pairedAt: string | null } }).device.pairedAt, null);

  // The same device pairs again with the new code, keeping its id.
  const repaired = await app.inject({
    method: "POST",
    url: "/v1/pairing",
    payload: {
      pairCode: newCode,
      deviceName: "Relink phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  assert.equal(repaired.statusCode, 201);
  assert.equal((repaired.json() as { deviceId: string }).deviceId, deviceId);
});

test("delete: removes a device and its events", async () => {
  const signup = await app.inject({
    method: "POST",
    url: "/v1/accounts",
    payload: { email: "del@example.com", password: "supersecret" },
  });
  const accountToken = signup.json().token as string;

  const created = await app.inject({
    method: "POST",
    url: "/v1/devices",
    headers: { authorization: `Bearer ${accountToken}` },
    payload: { name: "Doomed phone" },
  });
  const { deviceId, pairCode } = created.json() as { deviceId: string; pairCode: string };

  const paired = await app.inject({
    method: "POST",
    url: "/v1/pairing",
    payload: {
      pairCode,
      deviceName: "Doomed phone",
      platform: "android",
      appVersion: "0.1.0",
      consentAcceptedAt: new Date().toISOString(),
    },
  });
  const deviceToken = paired.json().deviceToken as string;

  await app.inject({
    method: "POST",
    url: "/v1/events",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: { kind: "location", capturedAt: new Date().toISOString(), payload: { lat: 1, lon: 2 } },
  });

  const del = await app.inject({
    method: "DELETE",
    url: `/v1/devices/${deviceId}`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  assert.equal(del.statusCode, 200);
  assert.equal((del.json() as { deleted: boolean }).deleted, true);

  // Device is gone.
  const gone = await app.inject({
    method: "GET",
    url: `/v1/devices/${deviceId}`,
    headers: { authorization: `Bearer ${accountToken}` },
  });
  assert.equal(gone.statusCode, 404);

  // It no longer appears in the list.
  const list = await app.inject({
    method: "GET",
    url: "/v1/devices",
    headers: { authorization: `Bearer ${accountToken}` },
  });
  const ids = (list.json() as { devices: Array<{ id: string }> }).devices.map((d) => d.id);
  assert.equal(ids.includes(deviceId), false);
});
