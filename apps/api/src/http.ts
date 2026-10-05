import type { FastifyReply } from "fastify";

/** Sends an RFC 9457 problem-details error. */
export function problem(
  reply: FastifyReply,
  status: number,
  title: string,
  extra: Record<string, unknown> = {},
) {
  return reply
    .code(status)
    .type("application/problem+json")
    .send({ type: "about:blank", title, status, ...extra });
}

export function tooMany(reply: FastifyReply, retryAfterMs: number) {
  reply.header("retry-after", Math.max(1, Math.ceil(retryAfterMs / 1000)));
  return problem(reply, 429, "Too many requests. Please try again later.");
}

export function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
