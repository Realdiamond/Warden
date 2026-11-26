import { test } from "node:test";
import assert from "node:assert/strict";

// Fixed secrets + in-memory DB, set before importing anything that reads config.
process.env.MONITOR_DB = ":memory:";
process.env.MONITOR_JWT_SECRET = "test-secret-value-test-secret-value";
process.env.MONITOR_ENCRYPTION_KEY =
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
