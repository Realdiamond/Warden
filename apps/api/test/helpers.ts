import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { type Config, loadConfig } from "../src/config.ts";
import { migrate } from "../src/db/migrate.ts";
import { createPool, type Pool } from "../src/db/pool.ts";
import { createStaff } from "../src/services/staff.ts";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://warden:warden_dev@localhost:5432/warden_test";

export const LAGOS = { lat: 6.5244, lng: 3.3792 };

export interface TestContext {
  app: FastifyInstance;
  pool: Pool;
  config: Config;
  logs: string[];
  now: () => Date;
  advance: (ms: number) => void;
  close: () => Promise<void>;
}

/** A fresh schema per test: real PostgreSQL + PostGIS, controllable clock, captured logs. */
export async function createTestContext(): Promise<TestContext> {
  const schema = `t_${randomBytes(6).toString("hex")}`;
  const admin = createPool(TEST_DATABASE_URL);
  await admin.query(`CREATE SCHEMA ${schema}`);
  const pool = createPool(TEST_DATABASE_URL, { searchPath: `${schema},public` });
  await migrate(pool);

  const config = loadConfig({
    NODE_ENV: "test",
    DATABASE_URL: TEST_DATABASE_URL,
    LOG_LEVEL: "info",
    WARDEN_FIELD_KEY: randomBytes(32).toString("base64"),
    WARDEN_HMAC_KEY: randomBytes(32).toString("base64"),
  });

  let current = new Date("2026-10-05T12:00:00.000Z");
  const logs: string[] = [];
  const app = await buildApp({
    config,
    pool,
    now: () => current,
    random: () => 0,
    logStream: { write: (line: string) => logs.push(line) },
  });
  await app.ready();

  return {
    app,
    pool,
    config,
    logs,
    now: () => current,
    advance: (ms) => {
      current = new Date(current.getTime() + ms);
    },
    close: async () => {
      await app.close();
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
}

export interface SubmitOptions {
  install?: string;
  key?: string;
}

export function submitReport(ctx: TestContext, body: unknown, options: SubmitOptions = {}) {
  return ctx.app.inject({
    method: "POST",
    url: "/v1/reports",
    headers: {
      "x-warden-install": options.install ?? randomUUID(),
      "idempotency-key": options.key ?? randomUUID(),
    },
    payload: body as Record<string, unknown>,
  });
}

export async function mapAround(ctx: TestContext, window = "24h") {
  const response = await ctx.app.inject({
    method: "GET",
    url: `/v1/map/incidents?bbox=3.2,6.4,3.6,6.7&window=${window}`,
  });
  return response.json() as { incidents: Array<Record<string, unknown>> };
}

export async function signInStaff(ctx: TestContext, role: "moderator" | "admin" = "moderator") {
  const email = `mod-${randomBytes(3).toString("hex")}@warden.test`;
  const password = "correct horse battery staple";
  await createStaff(ctx.pool, { email, password, role }, ctx.now());
  const response = await ctx.app.inject({
    method: "POST",
    url: "/v1/admin/login",
    headers: { "x-warden-console": "1" },
    payload: { email, password },
  });
  const cookie = response.cookies.find((c) => c.name === "warden_staff");
  if (!cookie) throw new Error(`Login failed: ${response.statusCode} ${response.body}`);
  return { email, cookie: `warden_staff=${cookie.value}` };
}
