import type { FastifyReply, FastifyRequest } from "fastify";
import { SignJWT, jwtVerify } from "jose";
import { config } from "./config.ts";

const secret = new TextEncoder().encode(config.jwtSecret);

export async function signAccountToken(accountId: string): Promise<string> {
  return new SignJWT({ sub: accountId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret);
}

export function bearerToken(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && token ? token : null;
}

/** Returns the authenticated account id, or sends a 401 and returns null. */
export async function requireAccount(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const token = bearerToken(req);
  if (!token) {
    reply.code(401).send({ error: "missing_token" });
    return null;
  }
  try {
    const { payload } = await jwtVerify(token, secret);
    if (typeof payload.sub === "string") return payload.sub;
  } catch {
    // fall through to 401
  }
  reply.code(401).send({ error: "invalid_token" });
  return null;
}
