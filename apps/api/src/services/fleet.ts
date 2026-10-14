// Fleet dashboard (M9): transport and logistics companies watch the places they care about.
// They see only what the public map shows, gathered per zone, plus the area outlook and a route
// check. They never see reports, reporters, exact points or private categories.

import { randomUUID } from "node:crypto";
import {
  type BBox,
  distanceMeters,
  type FleetOverview,
  type FleetZone,
  type FleetZoneInput,
  type FleetZoneSummary,
  MAX_BBOX_SPAN_DEG,
  MAX_FLEET_ZONES,
  type RouteCheckResult,
  routeArea,
  routeScore,
  type StaffUser,
} from "@warden/shared";
import { cellsFor } from "@warden/shared/geo";
import { withTransaction } from "../db/pool.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";
import { mapIncidents } from "./incidents.ts";
import { outlookFor } from "./outlook.ts";

/** A public area is a few kilometres across; count one that reaches into the zone. */
const AREA_REACH_M = 2_500;

function orgId(staff: StaffUser): string {
  if (staff.role !== "fleet" || !staff.organisation) throw new Error("Not a fleet account");
  return staff.organisation.id;
}

/** The box around a circle, for map queries. */
export function boxAround(center: { lat: number; lng: number }, radiusM: number): BBox {
  const dLat = radiusM / 111_000;
  const dLng = dLat / Math.cos((center.lat * Math.PI) / 180);
  return {
    minLat: center.lat - dLat,
    maxLat: center.lat + dLat,
    minLng: center.lng - dLng,
    maxLng: center.lng + dLng,
  };
}

interface ZoneRow {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radius_m: number;
}

const toZone = (row: ZoneRow): FleetZone => ({
  id: row.id,
  name: row.name,
  center: { lat: row.lat, lng: row.lng },
  radiusM: row.radius_m,
});

export async function listZones(deps: ServiceDeps, staff: StaffUser): Promise<FleetZone[]> {
  const { rows } = await deps.pool.query<ZoneRow>(
    `SELECT id, name, lat, lng, radius_m FROM fleet_zones
      WHERE organisation_id = $1 AND deleted_at IS NULL ORDER BY name`,
    [orgId(staff)],
  );
  return rows.map(toZone);
}

export async function addZone(
  deps: ServiceDeps,
  staff: StaffUser,
  input: FleetZoneInput,
): Promise<{ ok: true; zone: FleetZone } | { ok: false; status: 409; message: string }> {
  const org = orgId(staff);
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    // One at a time per organisation, so the limit holds.
    await client.query("SELECT id FROM organisations WHERE id = $1 FOR UPDATE", [org]);
    const { rows } = await client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM fleet_zones WHERE organisation_id = $1 AND deleted_at IS NULL",
      [org],
    );
    if ((rows[0]?.count ?? 0) >= MAX_FLEET_ZONES) {
      return { ok: false, status: 409, message: `You can watch up to ${MAX_FLEET_ZONES} places.` };
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO fleet_zones (id, organisation_id, name, lat, lng, radius_m, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, org, input.name, input.center.lat, input.center.lng, input.radiusM, staff.id, now],
    );
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "fleet_zone.create",
      objectType: "fleet_zone",
      objectId: id,
      details: { organisationId: org },
    });
    return {
      ok: true,
      zone: { id, name: input.name, center: input.center, radiusM: input.radiusM },
    };
  });
}

export async function deleteZone(
  deps: ServiceDeps,
  staff: StaffUser,
  zoneId: string,
): Promise<boolean> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rowCount } = await client.query(
      `UPDATE fleet_zones SET deleted_at = $3
        WHERE id = $1 AND organisation_id = $2 AND deleted_at IS NULL`,
      [zoneId, orgId(staff), now],
    );
    if (!rowCount) return false;
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "fleet_zone.delete",
      objectType: "fleet_zone",
      objectId: zoneId,
    });
    return true;
  });
}

/** Each zone with the public incidents of the last 24 hours around it, worst first. */
export async function fleetOverview(deps: ServiceDeps, staff: StaffUser): Promise<FleetOverview> {
  const zones = await listZones(deps, staff);
  const summaries: FleetZoneSummary[] = [];
  for (const zone of zones) {
    const bbox = boxAround(zone.center, zone.radiusM + AREA_REACH_M);
    const incidents = (
      await mapIncidents(deps, { bbox, window: "24h", categories: undefined })
    ).filter(
      (incident) => distanceMeters(incident.center, zone.center) <= zone.radiusM + AREA_REACH_M,
    );
    const bySeverity = { critical: 0, high: 0, standard: 0 };
    for (const incident of incidents) bySeverity[incident.severity] += 1;
    const home = cellsFor(zone.center.lat, zone.center.lng).r7;
    const outlooks = await outlookFor(deps, boxAround(zone.center, 3_000));
    const outlook = outlooks.find((o) => o.cell === home) ?? null;
    summaries.push({
      zone,
      incidents,
      bySeverity,
      outlook: outlook
        ? {
            cell: outlook.cell,
            level: outlook.level,
            trend: outlook.trend,
            incidents: outlook.incidents,
            peak: outlook.peak,
          }
        : null,
    });
  }
  return { zones: summaries, generatedAt: deps.now().toISOString() };
}

/** The same score the app shows on the trip screen, for a planned journey. */
export async function checkRoute(
  deps: ServiceDeps,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
): Promise<RouteCheckResult> {
  const area = routeArea(from, to);
  if (
    area.maxLat - area.minLat > MAX_BBOX_SPAN_DEG ||
    area.maxLng - area.minLng > MAX_BBOX_SPAN_DEG
  ) {
    return { score: 100, level: "calm", nearby: [], tooLong: true };
  }
  const incidents = await mapIncidents(deps, { bbox: area, window: "7d", categories: undefined });
  return { ...routeScore(incidents, from, to, deps.now()), tooLong: false };
}
