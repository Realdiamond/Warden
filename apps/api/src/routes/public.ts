// Routes used by the app and the Lite web app. No account needed, nothing identifying logged.

import {
  AlertsQuerySchema,
  BBoxSchema,
  MapQuerySchema,
  ReactionSchema,
  ReportSubmissionSchema,
} from "@warden/shared";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { headerValue, problem, tooMany } from "../http.ts";
import { RateLimiter } from "../rateLimit.ts";
import { alertFeed } from "../services/alerts.ts";
import type { ServiceDeps } from "../services/deps.ts";
import { mapIncidents } from "../services/incidents.ts";
import { reactToIncident } from "../services/reactions.ts";
import { createReport, getReportStatus } from "../services/reports.ts";
import { publicPresence } from "../services/responders.ts";
import { safeStopsIn } from "../services/safeStops.ts";
import { isTrustedReporterCode, normaliseReporterCode } from "../services/trustedReporters.ts";

const INSTALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9_-]{8,128}$/;
const UUID = INSTALL_ID;

/** Security tab: flag anything above 10 reports an hour from one source. */
const REPORTS_PER_HOUR = 10;
const STATUS_CHECKS_PER_HOUR = 120;
const REACTIONS_PER_HOUR = 30;
/** Trusted reporters may report more, but a stolen code still cannot flood the map. */
const TRUSTED_REPORTS_PER_HOUR = 30;
/** Checking a code reads the database, so one phone cannot try codes without limit. */
const CODE_CHECKS_PER_HOUR = TRUSTED_REPORTS_PER_HOUR;

export function registerPublicRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  const reportLimiter = new RateLimiter(REPORTS_PER_HOUR, 3_600_000);
  const statusLimiter = new RateLimiter(STATUS_CHECKS_PER_HOUR, 3_600_000);
  const reactionLimiter = new RateLimiter(REACTIONS_PER_HOUR, 3_600_000);
  const trustedLimiter = new RateLimiter(TRUSTED_REPORTS_PER_HOUR, 3_600_000);
  const codeCheckLimiter = new RateLimiter(CODE_CHECKS_PER_HOUR, 3_600_000);

  app.post("/v1/reports", async (request, reply) => {
    const installId = headerValue(request.headers["x-warden-install"]);
    const idempotencyKey = headerValue(request.headers["idempotency-key"]);
    if (!installId || !INSTALL_ID.test(installId)) {
      return problem(reply, 400, "The X-Warden-Install header must be a UUID.");
    }
    if (!idempotencyKey || !IDEMPOTENCY_KEY.test(idempotencyKey)) {
      return problem(
        reply,
        400,
        "The Idempotency-Key header is required (8-128 letters, digits, - or _).",
      );
    }

    const reporterCode = headerValue(request.headers["x-warden-reporter-code"]);
    if (reporterCode) {
      const checks = codeCheckLimiter.hit(
        deps.hasher.hmacHex("rl-code-check", installId.toLowerCase()),
        deps.now().getTime(),
      );
      if (!checks.allowed) return tooMany(reply, checks.retryAfterMs);
    }
    const limit = reporterCode
      ? trustedLimiter.hit(
          deps.hasher.hmacHex("rl-trusted", normaliseReporterCode(reporterCode)),
          deps.now().getTime(),
        )
      : reportLimiter.hit(
          deps.hasher.hmacHex("rl-report", installId.toLowerCase()),
          deps.now().getTime(),
        );
    if (!limit.allowed) return tooMany(reply, limit.retryAfterMs);

    const submission = ReportSubmissionSchema.parse(request.body);
    if (reporterCode && !(await isTrustedReporterCode(deps, reporterCode))) {
      return problem(reply, 403, "This trusted reporter code is not valid any more.");
    }
    const result = await createReport(deps, {
      submission,
      installId: installId.toLowerCase(),
      idempotencyKey,
      channel: "app",
      trusted: Boolean(reporterCode),
    });
    if (!result.ok) return problem(reply, result.status, result.message);
    if (result.replayed) reply.header("idempotent-replayed", "true");
    return reply.code(201).send(result.receipt);
  });

  app.get<{ Params: { id: string } }>("/v1/reports/:id/status", async (request, reply) => {
    const installId = headerValue(request.headers["x-warden-install"]);
    const token = headerValue(request.headers["x-warden-status-token"]);
    if (!installId || !INSTALL_ID.test(installId) || !token) {
      return problem(reply, 404, "Report not found.");
    }
    const limit = statusLimiter.hit(
      deps.hasher.hmacHex("rl-status", installId.toLowerCase()),
      deps.now().getTime(),
    );
    if (!limit.allowed) return tooMany(reply, limit.retryAfterMs);

    const status = await getReportStatus(deps, request.params.id, token);
    if (!status) return problem(reply, 404, "Report not found.");
    reply.header("cache-control", "no-store");
    return status;
  });

  app.get("/v1/map/incidents", async (request, reply) => {
    const query = MapQuerySchema.parse(request.query);
    const incidents = await mapIncidents(deps, query);
    reply.header("cache-control", "public, max-age=30");
    return { incidents, generatedAt: deps.now().toISOString() };
  });

  app.post<{ Params: { id: string } }>("/v1/incidents/:id/reactions", async (request, reply) => {
    const installId = headerValue(request.headers["x-warden-install"]);
    if (!installId || !INSTALL_ID.test(installId)) {
      return problem(reply, 400, "The X-Warden-Install header must be a UUID.");
    }
    if (!UUID.test(request.params.id)) return problem(reply, 404, "Incident not found.");
    const limit = reactionLimiter.hit(
      deps.hasher.hmacHex("rl-reaction", installId.toLowerCase()),
      deps.now().getTime(),
    );
    if (!limit.allowed) return tooMany(reply, limit.retryAfterMs);

    const { kind } = ReactionSchema.parse(request.body);
    const outcome = await reactToIncident(deps, {
      incidentId: request.params.id.toLowerCase(),
      installId: installId.toLowerCase(),
      kind,
    });
    if (!outcome.ok) return problem(reply, outcome.status, outcome.message);
    reply.header("cache-control", "no-store");
    return outcome.result;
  });

  app.get("/v1/alerts", async (request, reply) => {
    const query = AlertsQuerySchema.parse(request.query);
    const feed = await alertFeed(deps, query);
    reply.header("cache-control", "public, max-age=15");
    return feed;
  });

  /** Responder deployments their organisations chose to show, as areas only. */
  app.get("/v1/map/presence", async (request, reply) => {
    const { bbox } = z.object({ bbox: BBoxSchema }).parse(request.query);
    const presence = await publicPresence(deps, bbox);
    reply.header("cache-control", "public, max-age=30");
    return { presence, generatedAt: deps.now().toISOString() };
  });

  /** Police stations, hospitals and other public places to head for. */
  app.get("/v1/safe-stops", async (request, reply) => {
    const { bbox } = z.object({ bbox: BBoxSchema }).parse(request.query);
    const stops = await safeStopsIn(deps.pool, bbox);
    reply.header("cache-control", "public, max-age=3600");
    return { stops };
  });
}
