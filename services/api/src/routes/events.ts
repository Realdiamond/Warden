import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.ts";
import { requireAccount, bearerToken } from "../auth.ts";
import { hashToken, encryptJson, decryptJson } from "../crypto.ts";
import { isEventKind, isSensitiveKind } from "../shared.ts";
import type { EventKind } from "../shared.ts";
import { parseBlocked } from "./devices.ts";

interface AuthedDevice {
  id: string;
  consent: string | null;
}

function authenticateDevice(req: FastifyRequest): AuthedDevice | null {
  const token = bearerToken(req);
  if (!token) return null;
  const row = db
    .prepare("SELECT id, consent_accepted_at FROM devices WHERE device_token_hash = ?")
    .get(hashToken(token)) as { id: string; consent_accepted_at: string | null } | undefined;
  if (!row) return null;
  return { id: row.id, consent: row.consent_accepted_at };
}

const eventSchema = z.object({
  kind: z.string(),
  capturedAt: z.string(),
  payload: z.unknown(),
});

interface EventRow {
  id: string;
  kind: string;
  captured_at: string;
  received_at: string;
  payload: string;
  encrypted: number;
}

export function registerEventRoutes(app: FastifyInstance): void {
  // The monitored device reports an event.
  app.post("/v1/events", async (req, reply) => {
    const device = authenticateDevice(req);
    if (!device) return reply.code(401).send({ error: "invalid_device_token" });
    // Consent gate: a device with no recorded consent cannot report anything.
    if (!device.consent) return reply.code(403).send({ error: "consent_not_recorded" });

    const parsed = eventSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { kind, capturedAt, payload } = parsed.data;
    if (!isEventKind(kind)) return reply.code(400).send({ error: "unknown_kind" });

    const sensitive = isSensitiveKind(kind as EventKind);
    const stored = sensitive ? encryptJson(payload) : JSON.stringify(payload ?? null);
    const now = new Date().toISOString();
    const id = randomUUID();

    db.prepare(
      `INSERT INTO events (id, device_id, kind, captured_at, received_at, payload, encrypted)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, device.id, kind, capturedAt, now, stored, sensitive ? 1 : 0);
    db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, device.id);

    return reply.code(201).send({ id });
  });

  // The parent reads a device's events.
  app.get("/v1/devices/:id/events", async (req, reply) => {
    const accountId = await requireAccount(req, reply);
    if (!accountId) return;
    const { id } = req.params as { id: string };

    const query = z
      .object({
        kind: z.string().optional(),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .safeParse(req.query);
    if (!query.success) return reply.code(400).send({ error: "invalid_query" });

    const owned = db
      .prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?")
      .get(id, accountId);
    if (!owned) return reply.code(404).send({ error: "not_found" });

    const { kind, limit } = query.data;
    const rows = (
      kind
        ? db
            .prepare(
              `SELECT id, kind, captured_at, received_at, payload, encrypted FROM events
                 WHERE device_id = ? AND kind = ? ORDER BY captured_at DESC LIMIT ?`,
            )
            .all(id, kind, limit)
        : db
            .prepare(
              `SELECT id, kind, captured_at, received_at, payload, encrypted FROM events
                 WHERE device_id = ? ORDER BY captured_at DESC LIMIT ?`,
            )
            .all(id, limit)
    ) as unknown as EventRow[];

    const events = rows.map((r) => ({
      id: r.id,
      deviceId: id,
      kind: r.kind,
      capturedAt: r.captured_at,
      receivedAt: r.received_at,
      payload: r.encrypted ? decryptJson(r.payload) : JSON.parse(r.payload),
    }));
    return reply.send({ events });
  });

  // The monitored device fetches its own block list.
  app.get("/v1/rules", async (req, reply) => {
    const device = authenticateDevice(req);
    if (!device) return reply.code(401).send({ error: "invalid_device_token" });
    const row = db.prepare("SELECT blocked_apps FROM devices WHERE id = ?").get(device.id) as
      | { blocked_apps: string | null }
      | undefined;
    return reply.send({ blockedApps: parseBlocked(row?.blocked_apps ?? null) });
  });

  // The monitored device fetches and acknowledges remote commands.
  app.get("/v1/commands", async (req, reply) => {
    const device = authenticateDevice(req);
    if (!device) return reply.code(401).send({ error: "invalid_device_token" });
    const rows = db
      .prepare(
        "SELECT id, type FROM commands WHERE device_id = ? AND done_at IS NULL ORDER BY created_at ASC LIMIT 20",
      )
      .all(device.id);
    return reply.send({ commands: rows });
  });

  app.post("/v1/commands/ack", async (req, reply) => {
    const device = authenticateDevice(req);
    if (!device) return reply.code(401).send({ error: "invalid_device_token" });
    const body = z.object({ ids: z.array(z.string()).max(50) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    const now = new Date().toISOString();
    const stmt = db.prepare("UPDATE commands SET done_at = ? WHERE id = ? AND device_id = ?");
    for (const id of body.data.ids) stmt.run(now, id, device.id);
    return reply.send({ acked: body.data.ids.length });
  });
}
