// Risk-data API (M9): paying customers (insurers, logistics firms, researchers) get counts of
// public incidents per area. Built on the public map only: H3 areas a few kilometres across,
// no exact points, no private categories, nothing about reports or reporters, and areas with
// fewer than DATA_MIN_INCIDENTS incidents left out. Keys are stored as keyed hashes; every
// request is counted per customer per day for quotas and invoices.

import { randomUUID } from "node:crypto";
import {
  type BBox,
  DATA_MIN_INCIDENTS,
  type DataArea,
  type DataUsageResponse,
  getCategory,
  type Severity,
} from "@warden/shared";
import { cellBoundary, cellCenter, cellsFor } from "@warden/shared/geo";
import { randomToken } from "../crypto.ts";
import { type Pool, withTransaction } from "../db/pool.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";
import { COUNTED_STATES } from "./outlook.ts";

const KEY_PREFIX = "wdn_";
/** Nigeria is UTC+1 all year; quotas reset at midnight there. */
const WAT_OFFSET_MS = 3_600_000;

export interface ApiClient {
  id: string;
  name: string;
  dailyQuota: number;
}

function keyHash(deps: Pick<ServiceDeps, "hasher">, key: string): Buffer {
  return deps.hasher.hmac("api-key", key);
}

export function nigeriaDay(at: Date): string {
  return new Date(at.getTime() + WAT_OFFSET_MS).toISOString().slice(0, 10);
}

export async function createApiClient(
  deps: Pick<ServiceDeps, "hasher" | "now"> & { pool: Pool },
  input: { name: string; dailyQuota: number },
  createdBy: string,
): Promise<{ id: string; key: string }> {
  const id = randomUUID();
  const key = `${KEY_PREFIX}${randomToken(32)}`;
  const now = deps.now();
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO api_clients (id, name, key_hash, key_prefix, daily_quota, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [id, input.name, keyHash(deps, key), key.slice(0, 10), input.dailyQuota, createdBy, now],
    );
    await appendAudit(client, {
      at: now,
      actorType: "system",
      actorId: createdBy,
      action: "api_client.create",
      objectType: "api_client",
      objectId: id,
      details: { name: input.name, dailyQuota: input.dailyQuota },
    });
  });
  return { id, key };
}

export async function revokeApiClient(
  deps: Pick<ServiceDeps, "now"> & { pool: Pool },
  id: string,
  revokedBy: string,
  reason: string,
): Promise<boolean> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rowCount } = await client.query(
      "UPDATE api_clients SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
      [id, now],
    );
    if (!rowCount) return false;
    await appendAudit(client, {
      at: now,
      actorType: "system",
      actorId: revokedBy,
      action: "api_client.revoke",
      objectType: "api_client",
      objectId: id,
      reason,
    });
    return true;
  });
}

/** The customer a key belongs to, or null for an unknown or revoked key. */
export async function apiClientForKey(
  deps: Pick<ServiceDeps, "hasher" | "pool">,
  key: string,
): Promise<ApiClient | null> {
  if (!key.startsWith(KEY_PREFIX) || key.length > 100) return null;
  const { rows } = await deps.pool.query<{ id: string; name: string; daily_quota: number }>(
    "SELECT id, name, daily_quota FROM api_clients WHERE key_hash = $1 AND revoked_at IS NULL",
    [keyHash(deps, key)],
  );
  const row = rows[0];
  return row ? { id: row.id, name: row.name, dailyQuota: row.daily_quota } : null;
}

/** Counts one request. Returns false once today's quota is used up (the request is not served). */
export async function countRequest(deps: ServiceDeps, client: ApiClient): Promise<boolean> {
  const { rows } = await deps.pool.query<{ requests: number }>(
    `INSERT INTO api_usage (client_id, day, requests) VALUES ($1, $2, 1)
     ON CONFLICT (client_id, day) DO UPDATE SET requests = api_usage.requests + 1
     RETURNING requests`,
    [client.id, nigeriaDay(deps.now())],
  );
  return (rows[0]?.requests ?? 0) <= client.dailyQuota;
}

export async function usageFor(
  deps: Pick<ServiceDeps, "pool">,
  client: ApiClient,
  days = 31,
): Promise<DataUsageResponse> {
  const { rows } = await deps.pool.query<{ day: string; requests: number }>(
    `SELECT to_char(day, 'YYYY-MM-DD') AS day, requests FROM api_usage
      WHERE client_id = $1 ORDER BY day DESC LIMIT $2`,
    [client.id, days],
  );
  return { name: client.name, dailyQuota: client.dailyQuota, days: rows };
}

/** Public incidents in the window, counted per area. Small counts are left out. */
export async function dataAreas(deps: ServiceDeps, bbox: BBox, days: number): Promise<DataArea[]> {
  const now = deps.now();
  const { rows } = await deps.pool.query<{
    category_id: string;
    severity: Severity;
    lat: number;
    lng: number;
  }>(
    `SELECT category_id, severity, ST_Y(public_point) AS lat, ST_X(public_point) AS lng
       FROM incidents
      WHERE handling = 'public'
        AND state = ANY($1::text[])
        AND publish_after IS NOT NULL AND publish_after <= $2
        AND first_reported_at >= $3
        AND public_point && ST_MakeEnvelope($4, $5, $6, $7, 4326)
      LIMIT 50000`,
    [
      COUNTED_STATES,
      now,
      new Date(now.getTime() - days * 86_400_000),
      bbox.minLng,
      bbox.minLat,
      bbox.maxLng,
      bbox.maxLat,
    ],
  );
  const areas = new Map<string, DataArea>();
  for (const row of rows) {
    const found = getCategory(row.category_id);
    const category = found?.handling === "public" ? found : null;
    if (!category) continue;
    const cell = cellsFor(row.lat, row.lng).r7;
    let area = areas.get(cell);
    if (!area) {
      area = {
        cell,
        center: cellCenter(cell),
        boundary: cellBoundary(cell),
        incidents: 0,
        bySeverity: { critical: 0, high: 0, standard: 0 },
        byGroup: {},
      };
      areas.set(cell, area);
    }
    area.incidents += 1;
    area.bySeverity[row.severity] += 1;
    area.byGroup[category.group] = (area.byGroup[category.group] ?? 0) + 1;
  }
  return [...areas.values()]
    .filter((area) => area.incidents >= DATA_MIN_INCIDENTS)
    .sort((a, b) => b.incidents - a.incidents);
}
