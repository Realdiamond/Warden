// Risk-data API (M9) for paying customers. Each request needs an API key in the Authorization
// header ("Bearer wdn_..."), counts towards the customer's daily quota, and returns only
// area-level counts built from the public map. See docs/data-api.md.

import {
  BBoxSchema,
  DATA_MIN_INCIDENTS,
  DataAreasQuerySchema,
  type DataAreasResponse,
  type DataOutlookResponse,
} from "@warden/shared";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { headerValue, problem, tooMany } from "../http.ts";
import { RateLimiter } from "../rateLimit.ts";
import {
  type ApiClient,
  apiClientForKey,
  countRequest,
  dataAreas,
  usageFor,
} from "../services/dataApi.ts";
import type { ServiceDeps } from "../services/deps.ts";
import { outlookFor } from "../services/outlook.ts";

export function registerDataRoutes(app: FastifyInstance, deps: ServiceDeps): void {
  const perMinute = new RateLimiter(60, 60_000);
  const clients = new WeakMap<FastifyRequest, ApiClient>();
  const current = (request: FastifyRequest): ApiClient => {
    const client = clients.get(request);
    if (!client) throw new Error("API client missing after authentication");
    return client;
  };

  app.register(async (data) => {
    data.addHook("onRequest", async (request, reply) => {
      reply.header("cache-control", "no-store");
      const auth = headerValue(request.headers.authorization) ?? "";
      const key = /^Bearer\s+(\S+)$/i.exec(auth)?.[1];
      const client = key ? await apiClientForKey(deps, key) : null;
      if (!client) {
        reply.header("www-authenticate", 'Bearer realm="warden-data"');
        return problem(reply, 401, "A valid API key is needed. Contact Warden for access.");
      }
      const limit = perMinute.hit(client.id, deps.now().getTime());
      if (!limit.allowed) return tooMany(reply, limit.retryAfterMs);
      // Checking usage is free, so a customer can always see where they stand.
      const url = request.url.split("?")[0];
      if (url !== "/v1/data/usage" && !(await countRequest(deps, client))) {
        return problem(
          reply,
          429,
          "Today's quota is used up. It resets at midnight, Nigeria time.",
        );
      }
      clients.set(request, client);
    });

    data.get("/v1/data/areas", async (request): Promise<DataAreasResponse> => {
      const { bbox } = z.object({ bbox: BBoxSchema }).parse(request.query);
      const { days } = DataAreasQuerySchema.parse(request.query);
      return {
        areas: await dataAreas(deps, bbox, days),
        days,
        minIncidents: DATA_MIN_INCIDENTS,
        generatedAt: deps.now().toISOString(),
      };
    });

    data.get("/v1/data/outlook", async (request): Promise<DataOutlookResponse> => {
      const { bbox } = z.object({ bbox: BBoxSchema }).parse(request.query);
      return { outlooks: await outlookFor(deps, bbox), generatedAt: deps.now().toISOString() };
    });

    data.get("/v1/data/usage", async (request) => usageFor(deps, current(request)));
  });
}
