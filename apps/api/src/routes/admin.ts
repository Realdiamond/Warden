// Moderator console routes. Session cookie (httpOnly, SameSite=Strict) plus a required custom
// header on every state-changing request, which browsers cannot send cross-site without CORS.

import {
  INCIDENT_STATES,
  type IncidentState,
  ModerationDecisionSchema,
  StaffLoginSchema,
  type StaffUser,
} from "@warden/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Config } from "../config.ts";
import { problem, tooMany } from "../http.ts";
import { RateLimiter } from "../rateLimit.ts";
import type { ServiceDeps } from "../services/deps.ts";
import { incidentDetail, moderateIncident, moderationQueue } from "../services/incidents.ts";
import { authenticate, login, logout, SESSION_ABSOLUTE_MS } from "../services/staff.ts";

export const SESSION_COOKIE = "warden_staff";
export const CONSOLE_HEADER = "x-warden-console";
const COOKIE_PATH = "/v1/admin";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerAdminRoutes(app: FastifyInstance, deps: ServiceDeps, config: Config): void {
  const perEmail = new RateLimiter(5, 15 * 60_000);
  const overall = new RateLimiter(100, 60_000);
  const staffByRequest = new WeakMap<FastifyRequest, StaffUser>();

  const requireConsoleHeader = (request: FastifyRequest, reply: FastifyReply) => {
    if (request.headers[CONSOLE_HEADER] !== "1") {
      problem(reply, 403, "Missing console header.");
      return false;
    }
    return true;
  };

  app.post("/v1/admin/login", async (request, reply) => {
    if (!requireConsoleHeader(request, reply)) return reply;
    const credentials = StaffLoginSchema.parse(request.body);
    const nowMs = deps.now().getTime();
    const global = overall.hit("all", nowMs);
    if (!global.allowed) return tooMany(reply, global.retryAfterMs);
    const mine = perEmail.hit(
      deps.hasher.hmacHex("rl-login", credentials.email.toLowerCase()),
      nowMs,
    );
    if (!mine.allowed) return tooMany(reply, mine.retryAfterMs);

    const result = await login(deps, credentials.email, credentials.password);
    if (!result.ok) return problem(reply, 401, "Email or password is incorrect.");
    reply.setCookie(SESSION_COOKIE, result.token, {
      path: COOKIE_PATH,
      httpOnly: true,
      sameSite: "strict",
      secure: config.cookieSecure,
      maxAge: Math.floor(SESSION_ABSOLUTE_MS / 1000),
    });
    return result.staff;
  });

  app.post("/v1/admin/logout", async (request, reply) => {
    if (!requireConsoleHeader(request, reply)) return reply;
    const token = request.cookies[SESSION_COOKIE];
    if (token) await logout(deps, token);
    reply.clearCookie(SESSION_COOKIE, { path: COOKIE_PATH });
    return reply.code(204).send();
  });

  app.register(async (admin) => {
    admin.addHook("preHandler", async (request, reply) => {
      if (request.method !== "GET" && !requireConsoleHeader(request, reply)) return reply;
      const token = request.cookies[SESSION_COOKIE];
      const staff = token ? await authenticate(deps, token) : null;
      if (!staff) return problem(reply, 401, "Please sign in.");
      staffByRequest.set(request, staff);
    });

    const currentStaff = (request: FastifyRequest): StaffUser => {
      const staff = staffByRequest.get(request);
      if (!staff) throw new Error("Staff missing after authentication");
      return staff;
    };

    admin.get("/v1/admin/me", async (request) => currentStaff(request));

    admin.get<{ Querystring: { state?: string } }>("/v1/admin/queue", async (request, reply) => {
      const state = (request.query.state ?? "held") as IncidentState;
      if (!INCIDENT_STATES.includes(state)) return problem(reply, 400, "Unknown state.");
      return { items: await moderationQueue(deps, state) };
    });

    admin.get<{ Params: { id: string } }>("/v1/admin/incidents/:id", async (request, reply) => {
      if (!UUID.test(request.params.id)) return problem(reply, 404, "Incident not found.");
      const detail = await incidentDetail(deps, request.params.id, currentStaff(request));
      if (!detail) return problem(reply, 404, "Incident not found.");
      reply.header("cache-control", "no-store");
      return detail;
    });

    admin.post<{ Params: { id: string } }>(
      "/v1/admin/incidents/:id/actions",
      async (request, reply) => {
        if (!UUID.test(request.params.id)) return problem(reply, 404, "Incident not found.");
        const decision = ModerationDecisionSchema.parse(request.body);
        const result = await moderateIncident(
          deps,
          request.params.id,
          currentStaff(request),
          decision,
        );
        if (!result.ok) return problem(reply, result.status, result.message);
        return result;
      },
    );
  });
}
