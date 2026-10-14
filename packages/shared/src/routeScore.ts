// Route safety score (M7). Worked out on the phone from the public map, so the start and end of
// a trip never leave the phone. The v1 idea of a server-side score per road was adapted: the
// server only ever sees which map area is being looked at, as it does for the map itself.

import type { Severity } from "./categories.ts";
import { distanceMeters, type LatLng } from "./distance.ts";

/** Incidents further than this from the straight line between start and end are ignored. */
export const CORRIDOR_M = 1_000;

export interface ScoredIncident {
  id: string;
  categoryId: string;
  severity: Severity;
  label: string;
  active: boolean;
  lastReportAt: string;
  center: LatLng;
}

export type RouteLevel = "calm" | "caution" | "avoid";

export interface RouteScore {
  /** 100 is calm; 0 is very risky. */
  score: number;
  level: RouteLevel;
  /** The incidents that count, worst first. */
  nearby: Array<ScoredIncident & { distanceM: number; weight: number }>;
}

const SEVERITY_WEIGHT: Record<Severity, number> = { critical: 40, high: 20, standard: 8 };

function recencyWeight(ageMs: number, active: boolean): number {
  const hours = ageMs / 3_600_000;
  if (hours <= 3) return active ? 1 : 0.6;
  if (hours <= 24) return active ? 0.6 : 0.3;
  if (hours <= 24 * 7) return 0.15;
  return 0;
}

const LABEL_WEIGHT: Record<string, number> = {
  Verified: 1,
  Corroborated: 0.8,
  Unconfirmed: 0.6,
  Resolved: 0.3,
  Disputed: 0.2,
};

function labelWeight(label: string): number {
  return LABEL_WEIGHT[label] ?? 0.6;
}

/** Shortest distance from a point to the segment a-b, in metres (flat-earth, fine under 100 km). */
export function distanceToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const ax = a.lng * k;
  const bx = b.lng * k;
  const px = p.lng * k;
  const dx = bx - ax;
  const dy = b.lat - a.lat;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (p.lat - a.lat) * dy) / len));
  return distanceMeters(p, { lat: a.lat + t * dy, lng: (ax + t * dx) / k });
}

export function routeScore(
  incidents: ScoredIncident[],
  from: LatLng,
  to: LatLng,
  now: Date,
): RouteScore {
  const nearby = incidents
    .map((incident) => {
      const distanceM = distanceToSegment(incident.center, from, to);
      const age = now.getTime() - new Date(incident.lastReportAt).getTime();
      const weight =
        distanceM > CORRIDOR_M
          ? 0
          : SEVERITY_WEIGHT[incident.severity] *
            recencyWeight(age, incident.active) *
            labelWeight(incident.label) *
            (distanceM <= CORRIDOR_M / 2 ? 1 : 0.5);
      return { ...incident, distanceM: Math.round(distanceM), weight };
    })
    .filter((item) => item.weight > 0)
    .sort((a, b) => b.weight - a.weight);
  const score = Math.max(0, Math.round(100 - nearby.reduce((sum, item) => sum + item.weight, 0)));
  const level: RouteLevel = score >= 80 ? "calm" : score >= 50 ? "caution" : "avoid";
  return { score, level, nearby };
}

/** The map area to load for a route: the box around both ends plus the corridor. */
export function routeArea(from: LatLng, to: LatLng) {
  const padLat = CORRIDOR_M / 111_000;
  const padLng = padLat / Math.cos((((from.lat + to.lat) / 2) * Math.PI) / 180);
  return {
    minLat: Math.min(from.lat, to.lat) - padLat,
    maxLat: Math.max(from.lat, to.lat) + padLat,
    minLng: Math.min(from.lng, to.lng) - padLng,
    maxLng: Math.max(from.lng, to.lng) + padLng,
  };
}
