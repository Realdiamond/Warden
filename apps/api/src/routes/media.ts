// Media routes (M8): voice notes, photos and videos for reports, SOS audio for contacts, the
// spoken version of broadcasts, and the public area outlook. Uploads are raw bytes with their
// content type; nothing identifying is logged.

import { BBoxSchema, MEDIA_MAX_BYTES } from "@warden/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { headerValue, problem, tooMany } from "../http.ts";
import { RateLimiter } from "../rateLimit.ts";
import type { ServiceDeps } from "../services/deps.ts";
import {
  addSessionClip,
  attachReportMedia,
  listSessionClips,
  readSessionClip,
} from "../services/media.ts";
import { outlookFor } from "../services/outlook.ts";
import { broadcastAudio } from "../services/responders.ts";
import { CONTROL_HEADER, VIEW_HEADER } from "./sessions.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[A-Za-z0-9_-]{20,100}$/;
const MAX_UPLOAD = Math.max(...Object.values(MEDIA_MAX_BYTES));

/** Sends stored bytes; never cached by shared caches unless public. */
function sendBytes(
  reply: FastifyReply,
  file: { contentType: string; data: Buffer },
  cache = "private, no-store",
) {
  return reply
    .header("content-type", file.contentType)
    .header("cache-control", cache)
    .header("x-content-type-options", "nosniff")
    .send(file.data);
}

export function registerMediaRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  const uploadLimiter = new RateLimiter(60, 3_600_000);
  // An SOS sends a 30-second clip at a time: 120 an hour, with room for retries.
  const clipLimiter = new RateLimiter(180, 3_600_000);

  app.register(async (scope) => {
    scope.addContentTypeParser(
      /^(audio|image|video)\//,
      { parseAs: "buffer", bodyLimit: MAX_UPLOAD },
      (_request, body, done) => done(null, body),
    );

    const limited = (key: string, reply: FastifyReply, limiter = uploadLimiter) => {
      const result = limiter.hit(deps.hasher.hmacHex("rl-media", key), deps.now().getTime());
      if (result.allowed) return false;
      tooMany(reply, result.retryAfterMs);
      return true;
    };

    /** A voice note, photo or video for a report the phone sent (proved by its status token). */
    scope.post<{ Params: { id: string } }>("/v1/reports/:id/media", async (request, reply) => {
      const token = headerValue(request.headers["x-warden-status-token"]);
      if (!UUID.test(request.params.id) || !token || !TOKEN.test(token)) {
        return problem(reply, 404, "Report not found.");
      }
      if (limited(request.params.id.toLowerCase(), reply)) return reply;
      if (!Buffer.isBuffer(request.body)) {
        return problem(reply, 415, "Send the file as audio, image or video bytes.");
      }
      const result = await attachReportMedia(deps, {
        reportId: request.params.id.toLowerCase(),
        statusToken: token,
        contentType: request.headers["content-type"],
        data: request.body,
      });
      if (!result.ok) return problem(reply, result.status, result.message);
      return reply.code(201).send({ id: result.id });
    });

    /** An audio clip recorded during an SOS. */
    scope.post<{ Params: { id: string } }>("/v1/sessions/:id/audio", async (request, reply) => {
      const token = headerValue(request.headers[CONTROL_HEADER]);
      if (!UUID.test(request.params.id) || !token || !TOKEN.test(token)) {
        return problem(reply, 404, "Session not found.");
      }
      if (limited(request.params.id.toLowerCase(), reply, clipLimiter)) return reply;
      if (!Buffer.isBuffer(request.body)) return problem(reply, 415, "Send audio bytes.");
      const at = Date.parse(headerValue(request.headers["x-warden-recorded-at"]) ?? "");
      const result = await addSessionClip(deps, {
        sessionId: request.params.id.toLowerCase(),
        controlToken: token,
        contentType: request.headers["content-type"],
        data: request.body,
        recordedAt: Number.isNaN(at) ? deps.now() : new Date(at),
      });
      if (!result.ok) return problem(reply, result.status, result.message);
      return reply.code(201).header("cache-control", "no-store").send({ id: result.id });
    });
  });

  app.get<{ Params: { id: string } }>("/v1/sessions/:id/audio", async (request, reply) => {
    const token = headerValue(request.headers[VIEW_HEADER]);
    if (!UUID.test(request.params.id) || !token || !TOKEN.test(token)) {
      return problem(reply, 404, "Session not found.");
    }
    const clips = await listSessionClips(deps, request.params.id.toLowerCase(), token);
    if (!clips) return problem(reply, 404, "Session not found.");
    return reply.header("cache-control", "no-store").send({ clips });
  });

  app.get<{ Params: { id: string; clipId: string } }>(
    "/v1/sessions/:id/audio/:clipId",
    async (request, reply) => {
      const token = headerValue(request.headers[VIEW_HEADER]);
      if (
        !UUID.test(request.params.id) ||
        !UUID.test(request.params.clipId) ||
        !token ||
        !TOKEN.test(token)
      ) {
        return problem(reply, 404, "Not found.");
      }
      const clip = await readSessionClip(
        deps,
        request.params.id.toLowerCase(),
        token,
        request.params.clipId.toLowerCase(),
      );
      if (!clip) return problem(reply, 404, "Not found.");
      return sendBytes(reply, clip);
    },
  );

  app.get<{ Params: { id: string } }>("/v1/broadcasts/:id/audio", async (request, reply) => {
    if (!UUID.test(request.params.id)) return problem(reply, 404, "Not found.");
    const audio = await broadcastAudio(deps, request.params.id.toLowerCase());
    if (!audio) return problem(reply, 404, "Not found.");
    return sendBytes(reply, audio, "public, max-age=3600");
  });

  /** How often serious things were reported in each area over the last 3 months. */
  app.get("/v1/areas/outlook", async (request, reply) => {
    const { bbox } = z.object({ bbox: BBoxSchema }).parse(request.query);
    const outlooks = await outlookFor(deps, bbox);
    reply.header("cache-control", "public, max-age=3600");
    return { outlooks, generatedAt: deps.now().toISOString() };
  });
}
