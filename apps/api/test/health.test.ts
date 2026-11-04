import { afterEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./helpers.ts";

let ctx: TestContext | null = null;

afterEach(async () => {
  await ctx?.close();
  ctx = null;
});

async function readyz(context: TestContext) {
  const response = await context.app.inject({ method: "GET", url: "/readyz" });
  return { status: response.statusCode, body: response.json() as Record<string, unknown> };
}

/** Waits for the background work to finish at least once. */
async function untilHousekeepingRan(context: TestContext) {
  for (let i = 0; i < 100; i += 1) {
    const { body } = await readyz(context);
    const housekeeping = body.housekeeping as { lastSuccessSecondsAgo: number | null };
    if (housekeeping.lastSuccessSecondsAgo !== null) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("housekeeping never ran");
}

describe("health checks", () => {
  it("keeps /healthz small for load balancers", async () => {
    ctx = await createTestContext();
    const response = await ctx.app.inject({ method: "GET", url: "/healthz" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true });
  });

  it("reports the database and says when background work is not running here", async () => {
    ctx = await createTestContext();
    const { status, body } = await readyz(ctx);
    expect(status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      database: { ok: true },
      housekeeping: { running: false },
    });
  });

  it("is ready once background work has run, and not once it stops", async () => {
    ctx = await createTestContext({ housekeepingIntervalMs: 10 });
    await untilHousekeepingRan(ctx);
    const fresh = await readyz(ctx);
    expect(fresh.status).toBe(200);
    expect(fresh.body.housekeeping).toMatchObject({ running: true, ok: true });

    // Break the background work (its text-message table is gone), then let the clock run on:
    // runs now fail, and the last success becomes too old.
    await ctx.pool.query("DROP TABLE sms_outbox CASCADE");
    ctx.advance(10 * 60_000);
    let stale = await readyz(ctx);
    const failed = () =>
      (stale.body.housekeeping as { lastFailureSecondsAgo: number | null })
        .lastFailureSecondsAgo !== null;
    for (let i = 0; i < 100 && !failed(); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      stale = await readyz(ctx);
    }
    expect(stale.status).toBe(503);
    expect(stale.body).toMatchObject({ ok: false, housekeeping: { running: true, ok: false } });
    expect(failed()).toBe(true);
    expect(ctx.logs.join("\n")).toContain("housekeeping failed");
  });

  it("gives a new server a few minutes before reporting stuck background work", async () => {
    ctx = await createTestContext({ housekeepingIntervalMs: 60_000 });
    expect((await readyz(ctx)).status).toBe(200);
    ctx.advance(6 * 60_000);
    expect((await readyz(ctx)).status).toBe(503);
  });

  it("raises the alarm when the hourly limit on texts to contacts is reached", async () => {
    ctx = await createTestContext();
    const cap = ctx.config.sms.hourlyCap;
    await ctx.pool.query(
      `INSERT INTO sms_outbox (event, to_hash, key_id, message_enc, next_attempt_at, created_at)
       SELECT 'test', '\\x00'::bytea, 'k', '\\x00'::bytea, $1, $1 FROM generate_series(1, $2)`,
      [ctx.now(), cap],
    );
    const { status, body } = await readyz(ctx);
    expect(status).toBe(503);
    expect(body).toMatchObject({ ok: false, texts: { ok: false } });
  });

  it("shows only timings and yes or no, nothing about reports, people or sessions", async () => {
    ctx = await createTestContext({ housekeepingIntervalMs: 10 });
    await untilHousekeepingRan(ctx);
    const { body } = await readyz(ctx);
    expect(Object.keys(body).sort()).toEqual([
      "database",
      "housekeeping",
      "ok",
      "texts",
      "uptimeSeconds",
    ]);
    expect(body.texts).toEqual({ ok: true });
    expect(Object.keys(body.database as object).sort()).toEqual(["ms", "ok"]);
    expect(Object.keys(body.housekeeping as object).sort()).toEqual([
      "lastFailureSecondsAgo",
      "lastSuccessSecondsAgo",
      "ok",
      "running",
    ]);
  });
});
