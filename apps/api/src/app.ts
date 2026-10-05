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
import { registerPublicRoutes } from "./routes/public.ts";
import type { ServiceDeps } from "./services/deps.ts";
import { runHousekeeping } from "./services/incidents.ts";

export interface AppOptions {
  config: Config;
  pool: Pool;
  now?: () => Date;
  random?: () => number;
  /** Where logs go; tests pass a stream to inspect them. */
  logStream?: { write(line: string): void };
  /** Run expiry and clean-up on this interval; off when omitted. */
  housekeepingIntervalMs?: number;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, pool } = options;

  const deps: ServiceDeps = {
    pool,
    cipher: new Cipher({
      currentKeyId: config.fieldKeyId,
      keys: new Map([[config.fieldKeyId, config.fieldKey]]),
    }),
    hasher: new Hasher(config.hmacKey),
    now: options.now ?? (() => new Date()),
    random: options.random ?? Math.random,
  };

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
          url: req.url.split("?")[0],
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

  app.get("/healthz", async () => {
    await pool.query("SELECT 1");
    return { ok: true };
  });

  registerPublicRoutes(app, deps);
  registerAdminRoutes(app, deps, config);

  const consoleDist = config.consoleDist ? resolve(config.consoleDist) : undefined;
  if (consoleDist && existsSync(consoleDist)) {
    await app.register(fastifyStatic, { root: consoleDist });
    app.setNotFoundHandler((request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/v1/")) {
        return reply.sendFile("index.html");
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
        .catch((err: unknown) => app.log.error({ err }, "housekeeping failed"));
    }, options.housekeepingIntervalMs);
    timer.unref();
    app.addHook("onClose", async () => clearInterval(timer));
  }

  return app;
}
