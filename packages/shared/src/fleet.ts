// Fleet dashboard and risk-data API (M9).
//
// Both are built on what the public map already shows: incidents in H3 areas that have passed
// the publication rules, never exact points, never private categories, and nothing about who
// reported. Paying customers get the same data gathered for their places, not more of it.

import { z } from "zod";
import type { GroupId, Severity } from "./categories.ts";
import type { AreaOutlook, PublicAreaOutlook } from "./outlook.ts";
import { NigeriaPoint } from "./responders.ts";
import type { RouteScore } from "./routeScore.ts";
import type { PublicIncident } from "./types.ts";

export const MAX_FLEET_ZONES = 50;

export const FleetZoneSchema = z.strictObject({
  name: z.string().trim().min(2).max(60),
  center: NigeriaPoint,
  radiusM: z.number().int().min(500).max(50_000),
});
export type FleetZoneInput = z.output<typeof FleetZoneSchema>;

export interface FleetZone {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  radiusM: number;
}

export interface FleetZoneSummary {
  zone: FleetZone;
  /** Incidents shown on the public map in the last 24 hours whose area touches the zone. */
  incidents: PublicIncident[];
  bySeverity: Record<Severity, number>;
  /** The 3-month outlook for the area at the zone's centre, when there is enough data. */
  outlook: AreaOutlook | null;
}

export interface FleetOverview {
  zones: FleetZoneSummary[];
  generatedAt: string;
}

export const RouteCheckSchema = z.strictObject({
  from: NigeriaPoint,
  to: NigeriaPoint,
});

export type RouteCheckResult = RouteScore & { tooLong: boolean };

// ---- Risk-data API ---------------------------------------------------------------------------

export const DATA_WINDOWS_DAYS = [7, 30, 90] as const;
/** Areas with fewer incidents than this are left out, so no single report can be singled out. */
export const DATA_MIN_INCIDENTS = 3;

export const DataAreasQuerySchema = z.object({
  days: z.coerce
    .number()
    .int()
    .refine((d) => (DATA_WINDOWS_DAYS as readonly number[]).includes(d), "days must be 7, 30 or 90")
    .default(30),
});

export interface DataArea {
  /** H3 resolution-7 cell, a few kilometres across. */
  cell: string;
  center: { lat: number; lng: number };
  boundary: Array<[number, number]>;
  incidents: number;
  bySeverity: Record<Severity, number>;
  byGroup: Partial<Record<GroupId, number>>;
}

export interface DataAreasResponse {
  areas: DataArea[];
  days: number;
  /** Areas with fewer incidents than this are not listed. */
  minIncidents: number;
  generatedAt: string;
}

export interface DataOutlookResponse {
  outlooks: PublicAreaOutlook[];
  generatedAt: string;
}

export interface DataUsageResponse {
  name: string;
  dailyQuota: number;
  /** Most recent first; Nigeria dates. */
  days: Array<{ day: string; requests: number }>;
}
