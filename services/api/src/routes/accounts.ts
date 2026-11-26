import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.ts";
import { hashPassword, verifyPassword } from "../crypto.ts";
import { signAccountToken } from "../auth.ts";

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export function registerAccountRoutes(app: FastifyInstance): void {
  // Sign up a parent account.
  app.post("/v1/accounts", async (req, reply) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const email = parsed.data.email.toLowerCase();

    const existing = db.prepare("SELECT id FROM accounts WHERE email = ?").get(email);
    if (existing) return reply.code(409).send({ error: "email_taken" });

    const id = randomUUID();
    db.prepare(
      "INSERT INTO accounts (id, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
    ).run(id, email, hashPassword(parsed.data.password), new Date().toISOString());

    return reply.code(201).send({ accountId: id, token: await signAccountToken(id) });
  });

  // Log in.
  app.post("/v1/sessions", async (req, reply) => {
    const parsed = credentials.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const email = parsed.data.email.toLowerCase();

    const row = db.prepare("SELECT id, password_hash FROM accounts WHERE email = ?").get(email) as
      | { id: string; password_hash: string }
      | undefined;
    if (!row || !verifyPassword(parsed.data.password, row.password_hash)) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    return reply.send({ accountId: row.id, token: await signAccountToken(row.id) });
  });
}
