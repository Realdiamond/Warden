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
  // Offline sync: a stable id the device assigns so a re-sent event is de-duplicated, not stored twice.
  clientId: z.string().min(1).max(80).optional(),
});

const batchSchema = z.object({
  events: z.array(eventSchema).min(1).max(200),
});

/**
 * Insert one event for a device, de-duplicating on clientId. Returns the stored id (existing one
 * if this clientId was already seen). Returns null for an unknown kind so the caller can decide.
 */
function insertEvent(
  deviceId: string,
  e: { kind: string; capturedAt: string; payload?: unknown; clientId?: string },
  now: string,
): { id: string; deduped: boolean } | null {
  if (!isEventKind(e.kind)) return null;
  if (e.clientId) {
    const existing = db
      .prepare("SELECT id FROM events WHERE device_id = ? AND client_id = ?")
      .get(deviceId, e.clientId) as { id: string } | undefined;
    if (existing) return { id: existing.id, deduped: true };
  }
  const sensitive = isSensitiveKind(e.kind as EventKind);
  const stored = sensitive ? encryptJson(e.payload) : JSON.stringify(e.payload ?? null);
  const id = randomUUID();
  db.prepare(
    `INSERT INTO events (id, device_id, kind, captured_at, received_at, payload, encrypted, client_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, deviceId, e.kind, e.capturedAt, now, stored, sensitive ? 1 : 0, e.clientId ?? null);
  return { id, deduped: false };
}

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
    if (!isEventKind(parsed.data.kind)) return reply.code(400).send({ error: "unknown_kind" });

    const now = new Date().toISOString();
    const result = insertEvent(device.id, parsed.data, now);
    if (!result) return reply.code(400).send({ error: "unknown_kind" });
    db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, device.id);

    return reply.code(201).send({ id: result.id, deduped: result.deduped });
  });

  // Offline sync: the monitored device flushes a batch of buffered events at once. Each is
  // de-duplicated on its clientId, so re-sending after a dropped connection never doubles data.
  app.post("/v1/events/batch", async (req, reply) => {
    const device = authenticateDevice(req);
    if (!device) return reply.code(401).send({ error: "invalid_device_token" });
    if (!device.consent) return reply.code(403).send({ error: "consent_not_recorded" });

    const parsed = batchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const now = new Date().toISOString();
    const ids: string[] = [];
    let stored = 0;
    db.exec("BEGIN");
    try {
      for (const e of parsed.data.events) {
        const r = insertEvent(device.id, e, now);
        if (!r) continue; // skip unknown kinds rather than failing the whole batch
        ids.push(r.id);
        if (!r.deduped) stored += 1;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    db.prepare("UPDATE devices SET last_seen_at = ? WHERE id = ?").run(now, device.id);

    return reply.code(201).send({ accepted: ids.length, stored, ids });
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
