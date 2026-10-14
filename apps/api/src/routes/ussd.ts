// USSD callback in the Africa's Talking format (form fields sessionId, phoneNumber, text).
// The address contains a secret shared only with the provider; the caller's number is used
// only as a keyed hash for rate limiting and is never stored or logged.

import { ReportSubmissionSchema } from "@warden/shared";
import type { FastifyInstance } from "fastify";
import { safeEqual } from "../crypto.ts";
import { problem } from "../http.ts";
import { RateLimiter } from "../rateLimit.ts";
import type { ServiceDeps } from "../services/deps.ts";
import { createReport } from "../services/reports.ts";
import { ussdStep } from "../ussd/menu.ts";

const REPORTS_PER_HOUR = 5;
const USSD_AREA_ACCURACY_M = 3_000;

export function registerUssdRoutes(
  app: FastifyInstance,
  deps: ServiceDeps,
  callbackSecret: string | null,
): void {
  const limiter = new RateLimiter(REPORTS_PER_HOUR, 3_600_000);

  app.register(async (scope) => {
    scope.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 4 * 1024 },
      (_request, body, done) => {
        done(null, Object.fromEntries(new URLSearchParams(String(body))));
      },
    );

    scope.post<{ Params: { secret: string } }>("/v1/ussd/:secret", async (request, reply) => {
      if (
        !callbackSecret ||
        !safeEqual(Buffer.from(request.params.secret), Buffer.from(callbackSecret))
      ) {
        return problem(reply, 404, "Not found");
      }
      const body = (request.body ?? {}) as Record<string, unknown>;
      const text = typeof body.text === "string" ? body.text : "";
      const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      const phone = typeof body.phoneNumber === "string" ? body.phoneNumber : "";
      reply.type("text/plain; charset=utf-8").header("cache-control", "no-store");
      if (!sessionId || !phone || text.length > 200) {
        return "END Something went wrong. Please dial again.";
      }

      const step = ussdStep(text);
      if (step.kind === "reply") return step.text;

      const caller = deps.hasher.hmacHex("ussd-caller", phone);
      const limit = limiter.hit(caller, deps.now().getTime());
      if (!limit.allowed) {
        return "END You have sent several reports already. Please try again later. In danger now? Call 112.";
      }
      const result = await createReport(deps, {
        submission: ReportSubmissionSchema.parse({
          categoryId: step.categoryId,
          location: { lat: step.area.lat, lng: step.area.lng, accuracyM: USSD_AREA_ACCURACY_M },
          description: `USSD report: ${step.area.name} area (approximate location)`,
          proximity: "unknown",
        }),
        installId: `ussd:${caller}`,
        // A provider retry of the same final step must not create a second report.
        idempotencyKey: `ussd_${deps.hasher.hmacHex("ussd-session", sessionId).slice(0, 40)}`,
        channel: "ussd",
      });
      if (!result.ok) return "END Sorry, the report could not be sent. Please try again.";
      return "END Thank you. Warden staff will check your report. In danger now? Call 112.";
    });
  });
}
