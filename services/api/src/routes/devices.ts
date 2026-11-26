import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db } from "../db.ts";
import { requireAccount } from "../auth.ts";
import { randomPairCode } from "../crypto.ts";
import { PAIR_CODE_TTL_MS } from "../shared.ts";
import type { DeviceSummary } from "../shared.ts";

interface DeviceRow {
  id: string;
  name: string | null;
  platform: string | null;
  paired_at: string | null;
  consent_accepted_at: string | null;
  last_seen_at: string | null;
}

function toSummary(r: DeviceRow): DeviceSummary {
  return {
    id: r.id,
    name: r.name,
    platform: r.platform,
    pairedAt: r.paired_at,
    consentAcceptedAt: r.consent_accepted_at,
    lastSeenAt: r.last_seen_at,
  };
}

const SELECT_COLS =
  "id, name, platform, paired_at, consent_accepted_at, last_seen_at";

export function registerDeviceRoutes(app: FastifyInstance): void {
  // Parent creates a device slot and gets a pair code to type into the monitored app.
  app.post("/v1/devices", async (req, reply) => {
    const accountId = await requireAccount(req, reply);
    if (!accountId) return;

    const body = z.object({ name: z.string().min(1).max(100).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });

    const id = randomUUID();
    const pairCode = randomPairCode();
    const now = Date.now();
    db.prepare(
      `INSERT INTO devices (id, account_id, name, pair_code, pair_code_expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      accountId,
      body.data.name ?? null,
      pairCode,
      new Date(now + PAIR_CODE_TTL_MS).toISOString(),
      new Date(now).toISOString(),
    );

    return reply.code(201).send({ deviceId: id, pairCode, pairCodeExpiresInMs: PAIR_CODE_TTL_MS });
  });

  // Parent lists its own devices.
  app.get("/v1/devices", async (req, reply) => {
    const accountId = await requireAccount(req, reply);
    if (!accountId) return;
    const rows = db
      .prepare(`SELECT ${SELECT_COLS} FROM devices WHERE account_id = ? ORDER BY created_at DESC`)
      .all(accountId) as unknown as DeviceRow[];
    return reply.send({ devices: rows.map(toSummary) });
  });

  // Parent reads one of its own devices.
  app.get("/v1/devices/:id", async (req, reply) => {
    const accountId = await requireAccount(req, reply);
    if (!accountId) return;
    const { id } = req.params as { id: string };
    const row = db
      .prepare(`SELECT ${SELECT_COLS} FROM devices WHERE id = ? AND account_id = ?`)
      .get(id, accountId) as DeviceRow | undefined;
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send({ device: toSummary(row) });
  });
}
