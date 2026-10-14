import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyAuditChain } from "../src/services/audit.ts";
import {
  createTestContext,
  LAGOS,
  signInResponder,
  signInStaff,
  type TestContext,
} from "./helpers.ts";

let ctx: TestContext;
beforeEach(async () => {
  ctx = await createTestContext();
});
afterEach(async () => {
  await ctx.close();
});

const FEED = "/v1/community/feed?bbox=3.2,6.4,3.6,6.7";
const TIP = "Avoid the Ojota underpass after 10pm, two phone snatchings this week.";

function sendTip(body: string, install = randomUUID(), location = LAGOS) {
  return ctx.app.inject({
    method: "POST",
    url: "/v1/community/tips",
    headers: { "x-warden-install": install },
    payload: { body, location },
  });
}

function asStaff(
  cookie: string,
  method: "GET" | "POST",
  url: string,
  payload?: Record<string, unknown>,
) {
  const headers = { cookie, "x-warden-console": "1" };
  return payload === undefined
    ? ctx.app.inject({ method, url, headers })
    : ctx.app.inject({ method, url, headers, payload });
}

async function feed() {
  const response = await ctx.app.inject({ method: "GET", url: FEED });
  expect(response.statusCode).toBe(200);
  return (response.json() as { posts: Array<Record<string, unknown>> }).posts;
}

describe("community tips", () => {
  it("shows a tip only after a moderator publishes it, with the area and not the point", async () => {
    const sent = await sendTip(TIP);
    expect(sent.statusCode).toBe(202);
    const { id } = sent.json() as { id: string };
    expect(await feed()).toEqual([]);

    // The text is encrypted at rest and no exact point is stored.
    const { rows } = await ctx.pool.query("SELECT * FROM community_posts");
    expect(rows[0].body_enc.toString("utf8")).not.toContain("Ojota");
    expect(Object.keys(rows[0])).not.toContain("lat");
    expect(rows[0].center_lat).not.toBe(LAGOS.lat);

    const { cookie } = await signInStaff(ctx);
    const queue = await asStaff(cookie, "GET", "/v1/admin/community/queue");
    expect(queue.json().items).toMatchObject([{ id, body: TIP, warnings: [] }]);
    const publish = await asStaff(cookie, "POST", `/v1/admin/community/posts/${id}/actions`, {
      action: "publish",
    });
    expect(publish.json()).toEqual({ state: "published" });

    const posts = await feed();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ id, kind: "tip", body: TIP, source: null });
    // The area centre is a few kilometres' worth of hexagon, not where the tip came from.
    expect(posts[0]?.center).not.toEqual(LAGOS);

    const audit = await ctx.pool.query(
      "SELECT action FROM audit_events WHERE object_type = 'community_post'",
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["community_post.publish"]);
    expect((await verifyAuditChain(ctx.pool)).ok).toBe(true);
  });

  it("warns moderators about personal details, needs a reason to reject, and limits senders", async () => {
    const install = randomUUID();
    await sendTip("The thief is Musa, call him on 0803 123 4567", install);
    const { cookie } = await signInStaff(ctx);
    const [item] = (await asStaff(cookie, "GET", "/v1/admin/community/queue")).json().items;
    expect(item.warnings).toContain("Contains a phone number");

    const url = `/v1/admin/community/posts/${item.id}/actions`;
    expect((await asStaff(cookie, "POST", url, { action: "reject" })).statusCode).toBe(400);
    const rejected = await asStaff(cookie, "POST", url, {
      action: "reject",
      reason: "Names a person",
    });
    expect(rejected.json()).toEqual({ state: "rejected" });
    expect((await asStaff(cookie, "POST", url, { action: "publish" })).statusCode).toBe(409);

    await sendTip(TIP, install);
    await sendTip(TIP, install);
    expect((await sendTip(TIP, install)).statusCode).toBe(429);
    expect((await sendTip("too short")).statusCode).toBe(400);
    expect((await sendTip(TIP, randomUUID(), { lat: 51.5, lng: -0.12 })).statusCode).toBe(400);
  });

  it("hides a post flagged by three phones until a moderator looks again", async () => {
    const { id } = (await sendTip(TIP)).json() as { id: string };
    const { cookie } = await signInStaff(ctx);
    const url = `/v1/admin/community/posts/${id}/actions`;
    await asStaff(cookie, "POST", url, { action: "publish" });

    const flag = (install: string) =>
      ctx.app.inject({
        method: "POST",
        url: `/v1/community/posts/${id}/flag`,
        headers: { "x-warden-install": install },
      });
    const same = randomUUID();
    expect((await flag(same)).statusCode).toBe(204);
    expect((await flag(same)).statusCode).toBe(204);
    expect(await feed()).toHaveLength(1);
    await flag(randomUUID());
    await flag(randomUUID());
    expect(await feed()).toHaveLength(0);
    expect((await flag(randomUUID())).statusCode).toBe(404);

    const [item] = (await asStaff(cookie, "GET", "/v1/admin/community/queue")).json().items;
    expect(item.warnings[0]).toBe("Hidden after 3 people flagged it");
    await asStaff(cookie, "POST", url, { action: "remove", reason: "Rumour" });
    expect(await feed()).toHaveLength(0);
  });
});

describe("notices and broadcasts in the feed", () => {
  it("publishes Warden team notices at once and includes live broadcasts", async () => {
    const { cookie } = await signInStaff(ctx);
    const notice = await asStaff(cookie, "POST", "/v1/admin/community/notices", {
      body: "Polling units close at 2pm. Expect crowds around Ikeja.",
      areaLabel: "Ikeja",
      center: LAGOS,
      hours: 12,
    });
    expect(notice.statusCode).toBe(201);

    const responder = await signInResponder(ctx, { name: "LASTMA" });
    const broadcast = await asStaff(responder.cookie, "POST", "/v1/admin/responder/broadcasts", {
      tier: "warning",
      message: "Flooding on Third Mainland Bridge. Avoid the area.",
      center: LAGOS,
      radiusM: 5_000,
      expiresInMinutes: 60,
    });
    expect(broadcast.statusCode).toBe(201);

    const posts = await feed();
    expect(posts.map((p) => [p.kind, p.source])).toEqual(
      expect.arrayContaining([
        ["notice", "Warden team"],
        ["broadcast", "LASTMA"],
      ]),
    );
    // Responders cannot moderate community posts.
    expect((await asStaff(responder.cookie, "GET", "/v1/admin/community/queue")).statusCode).toBe(
      403,
    );
    // Notices expire.
    ctx.advance(13 * 3_600_000);
    expect(await feed()).toEqual([]);
  });
});
