// Hash-chained, append-only audit log (Security tab: every staff action and every read of
// Restricted data is recorded). Each entry's hash covers the previous entry's hash, so any
// edit or deletion breaks the chain.

import { createHash } from "node:crypto";
import type { Client, Queryable } from "../db/pool.ts";

const CHAIN_LOCK = 724002;

export interface AuditEvent {
  at: Date;
  actorType: "staff" | "system";
  actorId: string;
  action: string;
  objectType: string;
  objectId: string;
  reason?: string | null;
  details?: Record<string, unknown>;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

function entryHash(event: AuditEvent, prevHash: Buffer | null): Buffer {
  const body = stableStringify([
    event.at.toISOString(),
    event.actorType,
    event.actorId,
    event.action,
    event.objectType,
    event.objectId,
    event.reason ?? null,
    event.details ?? {},
  ]);
  return createHash("sha256")
    .update(prevHash ?? Buffer.alloc(0))
    .update(body)
    .digest();
}

/** Appends one entry. Must run inside a transaction so the chain lock is held until commit. */
export async function appendAudit(client: Client, event: AuditEvent): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [CHAIN_LOCK]);
  const { rows } = await client.query<{ hash: Buffer }>(
    "SELECT hash FROM audit_events ORDER BY id DESC LIMIT 1",
  );
  const prevHash = rows[0]?.hash ?? null;
  const hash = entryHash(event, prevHash);
  await client.query(
    `INSERT INTO audit_events
       (at, actor_type, actor_id, action, object_type, object_id, reason, details, prev_hash, hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      event.at,
      event.actorType,
      event.actorId,
      event.action,
      event.objectType,
      event.objectId,
      event.reason ?? null,
      JSON.stringify(event.details ?? {}),
      prevHash,
      hash,
    ],
  );
}

interface AuditRow {
  id: string;
  at: Date;
  actor_type: "staff" | "system";
  actor_id: string;
  action: string;
  object_type: string;
  object_id: string;
  reason: string | null;
  details: Record<string, unknown>;
  prev_hash: Buffer | null;
  hash: Buffer;
}

export async function verifyAuditChain(
  db: Queryable,
): Promise<{ ok: true; entries: number } | { ok: false; brokenAtId: string }> {
  const { rows } = await db.query<AuditRow>("SELECT * FROM audit_events ORDER BY id ASC");
  let prev: Buffer | null = null;
  for (const row of rows) {
    const expected = entryHash(
      {
        at: row.at,
        actorType: row.actor_type,
        actorId: row.actor_id,
        action: row.action,
        objectType: row.object_type,
        objectId: row.object_id,
        reason: row.reason,
        details: row.details,
      },
      prev,
    );
    const prevMatches = prev === null ? row.prev_hash === null : row.prev_hash?.equals(prev);
    if (!prevMatches || !expected.equals(row.hash)) return { ok: false, brokenAtId: row.id };
    prev = row.hash;
  }
  return { ok: true, entries: rows.length };
}
