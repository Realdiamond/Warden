import { randomBytes, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../src/app.ts";
import { type Config, loadConfig } from "../src/config.ts";
import { Cipher, Hasher } from "../src/crypto.ts";
import { migrate } from "../src/db/migrate.ts";
import { createPool, type Pool } from "../src/db/pool.ts";
import type { ServiceDeps } from "../src/services/deps.ts";
import { createOrganisation } from "../src/services/responders.ts";
import { createStaff } from "../src/services/staff.ts";
import { Signer } from "../src/signing.ts";
import { MemorySmsSender } from "../src/sms/sender.ts";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://warden:warden_dev@localhost:5432/warden_test";

export const LAGOS = { lat: 6.5244, lng: 3.3792 };

export interface TestContext {
  app: FastifyInstance;
  pool: Pool;
  config: Config;
  logs: string[];
  sms: MemorySmsSender;
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
    WARDEN_SIGNING_KEY: randomBytes(32).toString("base64"),
    PUBLIC_WEB_URL: "https://warden.test",
    USSD_CALLBACK_SECRET: "ussd-test-secret-0123456789abcdef",
  });

  let current = new Date("2026-10-05T12:00:00.000Z");
  const logs: string[] = [];
  const sms = new MemorySmsSender();
  const app = await buildApp({
    sms,
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
    sms,
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

/** The same service dependencies the app uses, with the test clock, for calling services directly. */
export function serviceDeps(ctx: TestContext): ServiceDeps {
  return {
    pool: ctx.pool,
    cipher: new Cipher({
      currentKeyId: ctx.config.fieldKeyId,
      keys: new Map([[ctx.config.fieldKeyId, ctx.config.fieldKey]]),
    }),
    hasher: new Hasher(ctx.config.hmacKey),
    now: ctx.now,
    random: () => 0,
    sms: ctx.sms,
    smsHourlyCap: ctx.config.sms.hourlyCap,
    publicWebUrl: ctx.config.publicWebUrl,
    signer: ctx.config.signingKey
      ? new Signer(ctx.config.signingKey.seed, ctx.config.signingKey.id)
      : null,
  };
}

/** Lagos box used for test organisations. */
export const LAGOS_AREA = {
  type: "Polygon",
  coordinates: [
    [
      [2.69, 6.37],
      [4.35, 6.37],
      [4.35, 6.71],
      [2.69, 6.71],
      [2.69, 6.37],
    ],
  ],
};

export async function signInResponder(
  ctx: TestContext,
  options: { name?: string; jurisdiction?: unknown | null } = {},
) {
  const { id: organisationId } = await createOrganisation(
    ctx.pool,
    {
      name: options.name ?? "Lagos Police Test Desk",
      kind: "police",
      jurisdiction: options.jurisdiction === undefined ? LAGOS_AREA : options.jurisdiction,
    },
    ctx.now(),
  );
  const email = `desk-${randomBytes(3).toString("hex")}@police.test`;
  const password = "correct horse battery staple";
  await createStaff(ctx.pool, { email, password, role: "responder", organisationId }, ctx.now());
  const response = await ctx.app.inject({
    method: "POST",
    url: "/v1/admin/login",
    headers: { "x-warden-console": "1" },
    payload: { email, password },
  });
  const cookie = response.cookies.find((c) => c.name === "warden_staff");
  if (!cookie) throw new Error(`Login failed: ${response.statusCode} ${response.body}`);
  return { organisationId, cookie: `warden_staff=${cookie.value}` };
}
