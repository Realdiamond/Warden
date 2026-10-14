import { createHash, createPublicKey, randomUUID, verify } from "node:crypto";
import { broadcastSigningText, type SignedBroadcast } from "@warden/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runHousekeeping } from "../src/services/incidents.ts";
import { stripJpegMetadata } from "../src/services/media.ts";
import {
  categoryFromText,
  decideLead,
  newsQueue,
  parseFeed,
  parseNewsSources,
  placeFromText,
  saveLeads,
} from "../src/services/news.ts";
import { Signer } from "../src/signing.ts";
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

/** A minimal well-formed JPEG: start, a JFIF header, then the scan to the end. */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from("JFIF\0", "latin1"),
  Buffer.alloc(9, 1),
  Buffer.from([0xff, 0xda, 0x00, 0x08]),
  Buffer.alloc(200, 7),
  Buffer.from([0xff, 0xd9]),
]);
/** The same picture with an EXIF block holding a made-up GPS position. */
function withExif(jpeg: Buffer): Buffer {
  const exif = Buffer.from("Exif\0\0GPS 6.5244N 3.3792E serial 12345", "latin1");
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(exif.length + 2, 2);
  return Buffer.concat([jpeg.subarray(0, 2), header, exif, jpeg.subarray(2)]);
}
const M4A = Buffer.concat([
  Buffer.from([0, 0, 0, 0x20]),
  Buffer.from("ftypM4A ", "latin1"),
  Buffer.alloc(300, 3),
]);
const WEBM = Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.alloc(300, 1)]);

function as(cookie: string, url: string) {
  return ctx.app.inject({ method: "GET", url, headers: { cookie, "x-warden-console": "1" } });
}

async function reportWithReceipt() {
  const response = await submitReport(ctx, {
    categoryId: "armed_robbery",
    location: LAGOS,
    proximity: "here",
  });
  return response.json() as { reportId: string; statusToken: string };
}

function upload(reportId: string, token: string, type: string, data: Buffer) {
  return ctx.app.inject({
    method: "POST",
    url: `/v1/reports/${reportId}/media`,
    headers: { "x-warden-status-token": token, "content-type": type },
    payload: data,
  });
}

describe("report media", () => {
  it("keeps voice notes and photos for moderators only, and audits every read", async () => {
    const { reportId, statusToken } = await reportWithReceipt();
    expect((await upload(reportId, statusToken, "audio/mp4", M4A)).statusCode).toBe(201);
    const photo = await upload(reportId, statusToken, "image/jpeg", JPEG);
    expect(photo.statusCode).toBe(201);

    // Encrypted at rest.
    const { rows } = await ctx.pool.query("SELECT data_enc FROM report_media");
    expect(rows[0].data_enc.includes(JPEG.subarray(0, 16))).toBe(false);

    // Never in public responses.
    const map = await ctx.app.inject({
      method: "GET",
      url: "/v1/map/incidents?bbox=3.2,6.4,3.6,6.7&window=24h",
    });
    expect(map.body).not.toContain("media");

    const { cookie } = await signInStaff(ctx);
    const incidentId = (
      await ctx.pool.query("SELECT incident_id FROM reports WHERE id = $1", [reportId])
    ).rows[0].incident_id;
    const detail = (await as(cookie, `/v1/admin/incidents/${incidentId}`)).json();
    expect(detail.reports[0].media.map((m: { kind: string }) => m.kind)).toEqual([
      "audio",
      "photo",
    ]);
    const file = await as(cookie, `/v1/admin/media/${photo.json().id}`);
    expect(file.statusCode).toBe(200);
    expect(file.headers["content-type"]).toBe("image/jpeg");
    expect(file.rawPayload.equals(JPEG)).toBe(true);
    // Without the console header (a link from another site) nothing is opened or audited.
    const linked = await ctx.app.inject({
      method: "GET",
      url: `/v1/admin/media/${photo.json().id}`,
      headers: { cookie },
    });
    expect(linked.statusCode).toBe(403);
    const audit = await ctx.pool.query(
      "SELECT action FROM audit_events WHERE action = 'report_media.read'",
    );
    expect(audit.rowCount).toBe(1);

    // A responder in the area can open it through their incident; others cannot.
    const responder = await signInResponder(ctx);
    const viaResponder = await as(
      responder.cookie,
      `/v1/admin/responder/incidents/${incidentId}/media/${photo.json().id}`,
    );
    expect([200, 404]).toContain(viaResponder.statusCode);
    expect((await as(responder.cookie, `/v1/admin/media/${photo.json().id}`)).statusCode).toBe(403);
  });

  it("refuses wrong tokens, disguised files, oversize files and a fourth file", async () => {
    const { reportId, statusToken } = await reportWithReceipt();
    const other = await reportWithReceipt();
    expect((await upload(reportId, other.statusToken, "image/jpeg", JPEG)).statusCode).toBe(404);
    expect((await upload(reportId, statusToken, "image/jpeg", M4A)).statusCode).toBe(415);
    expect((await upload(reportId, statusToken, "application/pdf", JPEG)).statusCode).toBe(415);
    const huge = Buffer.concat([JPEG, Buffer.alloc(2_100_000)]);
    expect((await upload(reportId, statusToken, "image/jpeg", huge)).statusCode).toBe(413);
    for (let i = 0; i < 3; i++) {
      expect((await upload(reportId, statusToken, "image/jpeg", JPEG)).statusCode).toBe(201);
    }
    expect((await upload(reportId, statusToken, "image/jpeg", JPEG)).statusCode).toBe(409);
  });

  it("removes hidden photo details such as the GPS position before storing", async () => {
    expect(stripJpegMetadata(withExif(JPEG))?.equals(JPEG)).toBe(true);
    expect(stripJpegMetadata(Buffer.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0]))).toBeNull();

    const { reportId, statusToken } = await reportWithReceipt();
    const sent = await upload(reportId, statusToken, "image/jpeg", withExif(JPEG));
    expect(sent.statusCode).toBe(201);
    const { cookie } = await signInStaff(ctx);
    const file = await as(cookie, `/v1/admin/media/${sent.json().id}`);
    expect(file.rawPayload.equals(JPEG)).toBe(true);
    expect(file.rawPayload.toString("latin1")).not.toContain("GPS");
  });

  it("deletes media after 30 days", async () => {
    const { reportId, statusToken } = await reportWithReceipt();
    await upload(reportId, statusToken, "image/jpeg", JPEG);
    ctx.advance(31 * 86_400_000);
    await runHousekeeping(serviceDeps(ctx));
    expect((await ctx.pool.query("SELECT 1 FROM report_media")).rowCount).toBe(0);
  });
});

describe("SOS audio", () => {
  async function start(kind: "sos" | "trip") {
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/sessions",
      headers: { "x-warden-install": randomUUID() },
      payload: {
        kind,
        personName: "Ada",
        contacts: [{ name: "Mum", phone: "0803 123 4567" }],
        ...(kind === "trip"
          ? { expectedArrivalAt: new Date(ctx.now().getTime() + 3_600_000).toISOString() }
          : {}),
      },
    });
    return response.json() as { sessionId: string; viewToken: string; controlToken: string };
  }

  it("lets contacts with the link play clips recorded during an SOS", async () => {
    const sos = await start("sos");
    const sent = await ctx.app.inject({
      method: "POST",
      url: `/v1/sessions/${sos.sessionId}/audio`,
      headers: {
        "x-warden-session-control": sos.controlToken,
        "content-type": "audio/mp4",
        "x-warden-recorded-at": ctx.now().toISOString(),
      },
      payload: M4A,
    });
    expect(sent.statusCode).toBe(201);

    const list = await ctx.app.inject({
      method: "GET",
      url: `/v1/sessions/${sos.sessionId}/audio`,
      headers: { "x-warden-session-view": sos.viewToken },
    });
    const clips = list.json().clips as Array<{ id: string }>;
    expect(clips).toHaveLength(1);
    const clip = await ctx.app.inject({
      method: "GET",
      url: `/v1/sessions/${sos.sessionId}/audio/${clips[0]?.id}`,
      headers: { "x-warden-session-view": sos.viewToken },
    });
    expect(clip.rawPayload.equals(M4A)).toBe(true);

    // The control token is not a view token.
    const wrong = await ctx.app.inject({
      method: "GET",
      url: `/v1/sessions/${sos.sessionId}/audio`,
      headers: { "x-warden-session-view": sos.controlToken },
    });
    expect(wrong.statusCode).toBe(404);
  });

  it("does not keep audio for trips", async () => {
    const trip = await start("trip");
    const sent = await ctx.app.inject({
      method: "POST",
      url: `/v1/sessions/${trip.sessionId}/audio`,
      headers: { "x-warden-session-control": trip.controlToken, "content-type": "audio/mp4" },
      payload: M4A,
    });
    expect(sent.statusCode).toBe(409);
  });
});

describe("spoken broadcasts", () => {
  it("signs the recording's hash so phones can check it before playing", async () => {
    const { cookie } = await signInResponder(ctx, { name: "LASTMA" });
    const response = await ctx.app.inject({
      method: "POST",
      url: "/v1/admin/responder/broadcasts",
      headers: { cookie, "x-warden-console": "1" },
      payload: {
        tier: "warning",
        message: "Flooding on Third Mainland Bridge. Avoid the area.",
        center: LAGOS,
        radiusM: 5_000,
        expiresInMinutes: 60,
        audio: { contentType: "audio/webm", data: WEBM.toString("base64") },
      },
    });
    expect(response.statusCode).toBe(201);
    const broadcast = response.json() as SignedBroadcast;
    expect(broadcast.audioSha256).toBe(createHash("sha256").update(WEBM).digest("hex"));

    const seed = ctx.config.signingKey?.seed;
    if (!seed) throw new Error("test signing key missing");
    const key = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        new Signer(seed, "s1").publicKey,
      ]),
      format: "der",
      type: "spki",
    });
    const text = Buffer.from(broadcastSigningText(broadcast));
    expect(text.toString()).toContain("warden-broadcast-v2");
    expect(verify(null, text, key, Buffer.from(broadcast.signature, "base64"))).toBe(true);
    const swapped = Buffer.from(
      broadcastSigningText({ ...broadcast, audioSha256: "0".repeat(64) }),
    );
    expect(verify(null, swapped, key, Buffer.from(broadcast.signature, "base64"))).toBe(false);

    const audio = await ctx.app.inject({
      method: "GET",
      url: `/v1/broadcasts/${broadcast.id}/audio`,
    });
    expect(audio.rawPayload.equals(WEBM)).toBe(true);

    // Phones get the hash in the alert feed too.
    ctx.advance(60_000);
    const tile = (await ctx.pool.query("SELECT tile FROM alert_events LIMIT 1")).rows[0].tile;
    const feed = await ctx.app.inject({ method: "GET", url: `/v1/alerts?tiles=${tile}` });
    expect(feed.json().alerts[0].broadcast.audioSha256).toBe(broadcast.audioSha256);
  });
});

describe("area outlook", () => {
  it("shows only areas with enough public incidents", async () => {
    for (let i = 0; i < 6; i++) {
      await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS, proximity: "here" });
      await submitReport(ctx, { categoryId: "armed_robbery", location: LAGOS, proximity: "here" });
      ctx.advance(2 * 86_400_000);
    }
    const response = await ctx.app.inject({
      method: "GET",
      url: "/v1/areas/outlook?bbox=3.2,6.4,3.6,6.7",
    });
    expect(response.statusCode).toBe(200);
    const { outlooks } = response.json() as { outlooks: Array<Record<string, unknown>> };
    expect(outlooks.length).toBeGreaterThanOrEqual(1);
    expect(outlooks[0]).toMatchObject({ level: expect.any(String), incidents: expect.any(Number) });
    expect(outlooks[0]?.boundary).toBeInstanceOf(Array);
    const empty = await ctx.app.inject({
      method: "GET",
      url: "/v1/areas/outlook?bbox=7.3,8.9,7.6,9.2",
    });
    expect(empty.json().outlooks).toEqual([]);
  });
});

describe("news leads", () => {
  const rss = () => `<?xml version="1.0"?><rss><channel>
    <item><title><![CDATA[Gunmen kidnap two in Ikorodu]]></title>
      <link>https://news.example/ikorodu</link>
      <pubDate>${ctx.now().toUTCString()}</pubDate>
      <description>&lt;p&gt;Residents said the attackers came at night.&lt;/p&gt;</description></item>
    <item><title>Football: Lagos side wins cup</title><link>https://news.example/football</link></item>
    <item><title>Kidnapping in a place we do not cover</title><link>https://news.example/far</link></item>
  </channel></rss>`;

  it("reads feeds and keeps only incidents in covered places", async () => {
    const items = parseFeed(rss());
    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      title: "Gunmen kidnap two in Ikorodu",
      summary: "Residents said the attackers came at night.",
    });
    expect(categoryFromText("Tanker explodes on Otedola bridge")).toBe("tanker_incident");
    expect(categoryFromText("Woman reports domestic violence")).toBeNull();
    expect(placeFromText("Fire in Victoria Island market")?.name).toBe("Victoria Island");
    expect(parseNewsSources("A|https://a.example/rss, bad, B|http://insecure")).toEqual([
      { name: "A", url: "https://a.example/rss" },
    ]);

    const deps = serviceDeps(ctx);
    expect(await saveLeads(deps, "Example", items)).toBe(1);
    expect(await saveLeads(deps, "Example", items)).toBe(0);
    const [lead] = await newsQueue(deps);
    expect(lead).toMatchObject({ categoryId: "kidnapping", place: "Ikorodu" });
  });

  it("goes on the map only when a moderator adds it, as an area and with an audit entry", async () => {
    const deps = serviceDeps(ctx);
    await saveLeads(deps, "Example", parseFeed(rss()));
    const [lead] = await newsQueue(deps);
    if (!lead) throw new Error("no lead");
    const { cookie } = await signInStaff(ctx);
    const added = await ctx.app.inject({
      method: "POST",
      url: `/v1/admin/news/${lead.id}/actions`,
      headers: { cookie, "x-warden-console": "1" },
      payload: { action: "add" },
    });
    expect(added.statusCode).toBe(200);
    const { rows } = await ctx.pool.query(
      "SELECT source, source_ref, state, public_cell FROM incidents WHERE id = $1",
      [added.json().incidentId],
    );
    expect(rows[0]).toMatchObject({
      source: "news",
      source_ref: "https://news.example/ikorodu",
      state: "unconfirmed",
    });
    expect(await newsQueue(deps)).toEqual([]);
    const again = await decideLead(
      deps,
      { id: "x", email: "x", role: "moderator", organisation: null },
      lead.id,
      { action: "dismiss" },
    );
    expect(again).toMatchObject({ ok: false, status: 409 });
  });
});
