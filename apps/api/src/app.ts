import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import type { Config } from "./config.ts";
import { Cipher, Hasher } from "./crypto.ts";
import type { Pool } from "./db/pool.ts";
import { problem } from "./http.ts";
import { registerAdminRoutes } from "./routes/admin.ts";
import { registerDataRoutes } from "./routes/data.ts";
import { registerMediaRoutes } from "./routes/media.ts";
import { registerPublicRoutes } from "./routes/public.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerUssdRoutes } from "./routes/ussd.ts";
import type { ServiceDeps } from "./services/deps.ts";
import { runHousekeeping } from "./services/incidents.ts";
import { runSessionHousekeeping } from "./services/sessions.ts";
import { deliverDueSms } from "./services/sms.ts";
import { Signer } from "./signing.ts";
import { LogSmsSender, type SmsSender, TermiiSmsSender } from "./sms/sender.ts";

/** /readyz reports a problem when the background work has not finished for this long. */
const HOUSEKEEPING_STALE_MS = 5 * 60_000;

export interface AppOptions {
  config: Config;
  pool: Pool;
  now?: () => Date;
  random?: () => number;
  /** Where logs go; tests pass a stream to inspect them. */
  logStream?: { write(line: string): void };
  /** Run expiry and clean-up on this interval; off when omitted. */
  housekeepingIntervalMs?: number;
  /** Replaces the configured SMS sender; tests pass an in-memory one. */
  sms?: SmsSender;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, pool } = options;
  let logSms: (entry: Record<string, unknown>) => void = () => undefined;
  const sms =
    options.sms ??
    (config.sms.driver === "termii"
      ? new TermiiSmsSender(config.sms)
      : new LogSmsSender((entry) => logSms(entry)));

  const deps: ServiceDeps = {
    pool,
    cipher: new Cipher(config.fieldKeys),
    hasher: new Hasher(config.hmacKey),
    now: options.now ?? (() => new Date()),
    random: options.random ?? Math.random,
    sms,
    smsHourlyCap: config.sms.hourlyCap,
    publicWebUrl: config.publicWebUrl,
    signer: config.signingKey ? new Signer(config.signingKey.seed, config.signingKey.id) : null,
  };
  /** When the background work last finished, for /readyz. */
  const housekeepingState: {
    startedAt: Date;
    lastSuccessAt: Date | null;
    lastFailureAt: Date | null;
  } = { startedAt: deps.now(), lastSuccessAt: null, lastFailureAt: null };

  const app = Fastify({
    bodyLimit: 16 * 1024,
    trustProxy: config.trustProxy,
    logger: {
      level: config.logLevel,
      ...(options.logStream ? { stream: options.logStream } : {}),
      // Never log IP addresses, hosts, headers or query strings: anonymous reporters must not
      // be traceable through logs (Security tab, anonymity engineering).
      serializers: {
        req: (req: { method: string; url: string }) => ({
          method: req.method,
          // The USSD callback address contains a secret.
          url: (req.url.split("?")[0] ?? "").replace(/^\/v1\/ussd\/.*/, "/v1/ussd/:secret"),
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  });

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:", ...config.mapOrigins],
        connectSrc: ["'self'", ...config.mapOrigins],
        workerSrc: ["'self'", "blob:"],
        fontSrc: ["'self'", "data:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        // Only force HTTPS in production, so the console can be tested over plain HTTP locally.
        upgradeInsecureRequests: config.env === "production" ? [] : null,
      },
    },
  });
  await app.register(cookie);
  logSms = (entry) => app.log.info(entry, "sms");

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) {
      return problem(reply, 400, "Invalid request", {
        errors: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status && status >= 400 && status < 500) {
      return problem(reply, status, (error as Error).message);
    }
    request.log.error({ err: error }, "unhandled error");
    return problem(reply, 500, "Something went wrong");
  });

  /** Cheap liveness check for load balancers and Docker: the process answers and so does the database. */
  app.get("/healthz", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  /**
   * Readiness for uptime monitors (docs/deploy.md, "Knowing it is up"): the database answers and
   * the background work (expiry, late trips, text messages) keeps running. Only timings and
   * yes/no answers, never counts or anything about reports, people or sessions.
   */
  app.get("/readyz", async (_request, reply) => {
    const started = Date.now();
    let database = true;
    try {
      await pool.query("SELECT 1");
    } catch {
      database = false;
    }
    const databaseMs = Date.now() - started;
    const now = deps.now().getTime();
    const secondsSince = (at: Date | null) =>
      at ? Math.max(0, Math.round((now - at.getTime()) / 1000)) : null;
    let housekeepingOk = true;
    let housekeeping: Record<string, unknown> = { running: false };
    if (options.housekeepingIntervalMs) {
      const staleAfterMs = Math.max(3 * options.housekeepingIntervalMs, HOUSEKEEPING_STALE_MS);
      const last = housekeepingState.lastSuccessAt;
      const reference = last ?? housekeepingState.startedAt;
      housekeepingOk = now - reference.getTime() <= staleAfterMs;
      housekeeping = {
        running: true,
        ok: housekeepingOk,
        lastSuccessSecondsAgo: secondsSince(last),
        lastFailureSecondsAgo: secondsSince(housekeepingState.lastFailureAt),
      };
    }
    // Texts to trusted contacts stop once the hourly cap is reached. Reaching it usually means
    // someone is starting fake trips or SOS (docs/security-review-2026-11.md), so the uptime
    // monitor should raise the alarm. Only yes or no, never how many.
    let textsOk = true;
    if (database) {
      const { rows } = await pool
        .query<{ capped: boolean }>(
          "SELECT count(*) >= $2 AS capped FROM sms_outbox WHERE created_at > $1",
          [new Date(now - 3_600_000), deps.smsHourlyCap],
        )
        .catch(() => ({ rows: [{ capped: false }] }));
      textsOk = !rows[0]?.capped;
    }
    const ok = database && housekeepingOk && textsOk;
    return reply.code(ok ? 200 : 503).send({
      ok,
      database: { ok: database, ms: databaseMs },
      housekeeping,
      texts: { ok: textsOk },
      uptimeSeconds: secondsSince(housekeepingState.startedAt),
    });
  });

  registerPublicRoutes(app, deps);
  registerSessionRoutes(app, deps);
  registerMediaRoutes(app, deps);
  registerUssdRoutes(app, deps, config.ussdCallbackSecret);
  registerDataRoutes(app, deps);
  registerAdminRoutes(app, deps, config);

  const consoleDist = config.consoleDist ? resolve(config.consoleDist) : undefined;
  if (consoleDist && existsSync(consoleDist)) {
    await app.register(fastifyStatic, { root: consoleDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/v1/")) {
        // The page contacts open from a trip or SOS link, the public privacy notice and terms,
        // and everything else is the console.
        const named = /^\/(live|privacy|terms)\/?(\?|$)/.exec(request.url)?.[1];
        const page = named ? `${named}.html` : "index.html";
        return reply.sendFile(page);
      }
      return problem(reply, 404, "Not found");
    });
  } else {
    app.setNotFoundHandler((_request, reply) => problem(reply, 404, "Not found"));
  }

  if (options.housekeepingIntervalMs) {
    const timer = setInterval(() => {
      runHousekeeping(deps)
        .then(({ expired }) => {
          if (expired > 0) app.log.info({ expired }, "incidents expired");
        })
        .then(() => runSessionHousekeeping(deps))
        .then((result) => {
          if (result.overdue + result.expired + result.deleted > 0) {
            app.log.info(result, "sessions housekeeping");
          }
        })
        .then(() => deliverDueSms(deps))
        .then(() => {
          housekeepingState.lastSuccessAt = deps.now();
        })
        .catch((err: unknown) => {
          housekeepingState.lastFailureAt = deps.now();
          app.log.error({ err }, "housekeeping failed");
        });
    }, options.housekeepingIntervalMs);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }

  return app;
}
