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
  blocked_apps: string | null;
}

export function parseBlocked(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function toSummary(r: DeviceRow): DeviceSummary {
  return {
    id: r.id,
    name: r.name,
    platform: r.platform,
    pairedAt: r.paired_at,
    consentAcceptedAt: r.consent_accepted_at,
    lastSeenAt: r.last_seen_at,
    blockedApps: parseBlocked(r.blocked_apps),
  };
}

const SELECT_COLS =
  "id, name, platform, paired_at, consent_accepted_at, last_seen_at, blocked_apps";

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

  // Parent sets which app packages are blocked on a device.
  app.put("/v1/devices/:id/rules", async (req, reply) => {
    const accountId = await requireAccount(req, reply);
    if (!accountId) return;
    const { id } = req.params as { id: string };
    const owned = db.prepare("SELECT id FROM devices WHERE id = ? AND account_id = ?").get(id, accountId);
    if (!owned) return reply.code(404).send({ error: "not_found" });
    const body = z.object({ blockedApps: z.array(z.string()).max(200) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_body" });
    db.prepare("UPDATE devices SET blocked_apps = ? WHERE id = ?").run(
      JSON.stringify(body.data.blockedApps),
      id,
    );
    return reply.send({ blockedApps: body.data.blockedApps });
  });
}
