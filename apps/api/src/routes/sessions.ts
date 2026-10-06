// Trip sharing and SOS. The phone authenticates with its control token, contacts with the view
// token from their link. Responses are never cached, and nothing identifying is logged.

import {
  SessionEndSchema,
  SessionExtendSchema,
  SessionPointsSchema,
  SessionStartSchema,
} from "@warden/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { headerValue, problem, tooMany } from "../http.ts";
import { RateLimiter } from "../rateLimit.ts";
import type { ServiceDeps } from "../services/deps.ts";
import {
  addPoints,
  endSession,
  extendSession,
  startSession,
  viewSession,
} from "../services/sessions.ts";
import { deliverDueSms } from "../services/sms.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;

export const CONTROL_HEADER = "x-warden-session-control";
export const VIEW_HEADER = "x-warden-session-view";

type IdRequest = FastifyRequest<{ Params: { id: string } }>;

export function registerSessionRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  const startLimiter = new RateLimiter(6, 3_600_000);
  const updateLimiter = new RateLimiter(400, 3_600_000);
  const viewLimiter = new RateLimiter(2_000, 3_600_000);

  /** Sends queued messages straight away instead of waiting for the next minute's run. */
  const kickSms = () => {
    void deliverDueSms(deps).catch((err: unknown) => app.log.error({ err }, "sms delivery failed"));
  };

  const tokenFor = (request: IdRequest, reply: FastifyReply, header: string) => {
    const token = headerValue(request.headers[header]);
    if (!UUID.test(request.params.id) || !token || !TOKEN.test(token)) {
      problem(reply, 404, "Session not found.");
      return null;
    }
    return token;
  };

  const limited = (
    limiter: RateLimiter,
    label: string,
    request: IdRequest,
    reply: FastifyReply,
  ) => {
    const result = limiter.hit(
      deps.hasher.hmacHex(label, request.params.id.toLowerCase()),
      deps.now().getTime(),
    );
    if (result.allowed) return false;
    tooMany(reply, result.retryAfterMs);
    return true;
  };

  app.addHook("onSend", async (request, reply) => {
    if (request.url.startsWith("/v1/sessions")) reply.header("cache-control", "no-store");
  });

  app.post("/v1/sessions", async (request, reply) => {
    const installId = headerValue(request.headers["x-warden-install"]);
    if (!installId || !UUID.test(installId)) {
      return problem(reply, 400, "The X-Warden-Install header must be a UUID.");
    }
    const limit = startLimiter.hit(
      deps.hasher.hmacHex("rl-session", installId.toLowerCase()),
      deps.now().getTime(),
    );
    if (!limit.allowed) return tooMany(reply, limit.retryAfterMs);

    const start = SessionStartSchema.parse(request.body);
    const result = await startSession(deps, start);
    if (!result.ok) return problem(reply, result.status, result.message);
    kickSms();
    return reply.code(201).send(result.receipt);
  });

  app.post<{ Params: { id: string } }>("/v1/sessions/:id/points", async (request, reply) => {
    const token = tokenFor(request, reply, CONTROL_HEADER);
    if (!token || limited(updateLimiter, "rl-session-update", request, reply)) return reply;
    const { points } = SessionPointsSchema.parse(request.body);
    const result = await addPoints(deps, request.params.id.toLowerCase(), token, points);
    if (!result.ok) return problem(reply, result.status, result.message);
    return { accepted: result.accepted, state: result.state };
  });

  app.post<{ Params: { id: string } }>("/v1/sessions/:id/extend", async (request, reply) => {
    const token = tokenFor(request, reply, CONTROL_HEADER);
    if (!token || limited(updateLimiter, "rl-session-update", request, reply)) return reply;
    const { minutes } = SessionExtendSchema.parse(request.body);
    const result = await extendSession(deps, request.params.id.toLowerCase(), token, minutes);
    if (!result.ok) return problem(reply, result.status, result.message);
    kickSms();
    return { expectedArrivalAt: result.expectedArrivalAt };
  });

  app.post<{ Params: { id: string } }>("/v1/sessions/:id/end", async (request, reply) => {
    const token = tokenFor(request, reply, CONTROL_HEADER);
    if (!token || limited(updateLimiter, "rl-session-update", request, reply)) return reply;
    const end = SessionEndSchema.parse(request.body);
    const result = await endSession(deps, request.params.id.toLowerCase(), token, end);
    if (!result.ok) return problem(reply, result.status, result.message);
    kickSms();
    // The same answer with or without duress, so the phone's screen cannot give it away.
    return { ended: true };
  });

  app.get<{ Params: { id: string } }>("/v1/sessions/:id/view", async (request, reply) => {
    const token = tokenFor(request, reply, VIEW_HEADER);
    if (!token || limited(viewLimiter, "rl-session-view", request, reply)) return reply;
    const view = await viewSession(deps, request.params.id.toLowerCase(), token);
    if (!view) return problem(reply, 404, "Session not found.");
    return view;
  });
}
