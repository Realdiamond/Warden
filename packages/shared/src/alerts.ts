// Alerts and community reactions (PRD modules 4 and 7). Phones ask for alerts by coarse map
// tiles of about 11 km and match their saved places on the phone, so the server never learns
// where anyone lives.

import { z } from "zod";
import type { CategoryId, Severity } from "./categories.ts";
import type { SignedBroadcast } from "./responders.ts";
import type { IncidentState, PublicLabel } from "./rules.ts";

export const ALERT_KINDS = ["new", "upgraded", "resolved", "correction", "broadcast"] as const;
export type AlertKind = (typeof ALERT_KINDS)[number];

export type AlertTier = "critical" | "warning" | "advisory";

export function tierFor(severity: Severity): AlertTier {
  if (severity === "critical") return "critical";
  if (severity === "high") return "warning";
  return "advisory";
}

/** How close a saved place must be for an alert to apply, by tier. */
export const ALERT_RADIUS_M: Record<AlertTier, number> = {
  critical: 3_000,
  warning: 2_000,
  advisory: 1_000,
};

/** Tiles are 0.1° squares (about 11 km in Nigeria). */
export const TILE_SIZE_DEG = 0.1;

export function tileFor(lat: number, lng: number): string {
  return `${Math.floor(lat / TILE_SIZE_DEG)}_${Math.floor(lng / TILE_SIZE_DEG)}`;
}

/** The tile around a point and its eight neighbours, so nearby alerts across a tile edge are seen. */
export function tilesAround(lat: number, lng: number): string[] {
  const row = Math.floor(lat / TILE_SIZE_DEG);
  const col = Math.floor(lng / TILE_SIZE_DEG);
  const tiles: string[] = [];
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) tiles.push(`${row + dr}_${col + dc}`);
  }
  return tiles;
}

/** Room for five saved places and the current area, nine tiles each. */
export const MAX_ALERT_TILES = 54;
const TILE_PATTERN = /^-?\d{1,4}_-?\d{1,4}$/;

export const AlertsQuerySchema = z.object({
  tiles: z
    .string()
    .transform((value) => [...new Set(value.split(",").map((t) => t.trim()))])
    .pipe(z.array(z.string().regex(TILE_PATTERN)).min(1).max(MAX_ALERT_TILES)),
  after: z
    .string()
    .regex(/^\d{1,16}_\d{1,19}$/)
    .optional(),
});
export type AlertsQuery = z.output<typeof AlertsQuerySchema>;

export interface PublicAlert {
  /** Opaque, increasing within the feed. */
  id: string;
  incidentId: string | null;
  kind: AlertKind;
  tier: AlertTier;
  categoryId: CategoryId | null;
  label: PublicLabel | null;
  center: { lat: number; lng: number };
  /** For broadcasts: the agency's message and name. */
  message: string | null;
  source: string | null;
  visibleAt: string;
  /** For broadcasts: everything needed to check the signature on the phone. */
  broadcast: SignedBroadcast | null;
}

export interface AlertsResponse {
  alerts: PublicAlert[];
  /** Pass back as `after` to get only newer alerts. */
  cursor: string | null;
}

export const REACTION_KINDS = ["confirm", "over", "false"] as const;
export type ReactionKind = (typeof REACTION_KINDS)[number];

export const ReactionSchema = z.strictObject({ kind: z.enum(REACTION_KINDS) });

/** Community thresholds: enough independent phones saying "it's over" or "looks false". */
export const OVER_VOTES_TO_RESOLVE = { unconfirmed: 2, verified: 3 } as const;
export const FALSE_VOTES_TO_DISPUTE = 3;

export interface ReactionResult {
  accepted: boolean;
  label: PublicLabel | null;
}

export interface CommunityCounts {
  confirmations: number;
  overVotes: number;
  falseVotes: number;
}

/**
 * What community reactions can do without a moderator. Critical incidents always need a
 * moderator, so a handful of phones can never hide a kidnapping or an attack in progress.
 */
export function communityOutcome(
  state: IncidentState,
  severity: Severity,
  counts: CommunityCounts,
): IncidentState | null {
  if (severity === "critical") return null;
  if (state === "verified") {
    return counts.overVotes >= OVER_VOTES_TO_RESOLVE.verified ? "resolved" : null;
  }
  if (state !== "unconfirmed" && state !== "disputed") return null;
  if (counts.overVotes >= OVER_VOTES_TO_RESOLVE.unconfirmed) return "resolved";
  if (
    state === "unconfirmed" &&
    counts.falseVotes >= FALSE_VOTES_TO_DISPUTE &&
    counts.falseVotes > counts.confirmations
  ) {
    return "disputed";
  }
  return null;
}

/** Every tile a circle touches, for broadcasts wider than one tile. */
export function tilesForCircle(lat: number, lng: number, radiusM: number): string[] {
  const dLat = radiusM / 111_320;
  const dLng = radiusM / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  const rowMin = Math.floor((lat - dLat) / TILE_SIZE_DEG);
  const rowMax = Math.floor((lat + dLat) / TILE_SIZE_DEG);
  const colMin = Math.floor((lng - dLng) / TILE_SIZE_DEG);
  const colMax = Math.floor((lng + dLng) / TILE_SIZE_DEG);
  const tiles: string[] = [];
  for (let row = rowMin; row <= rowMax; row += 1) {
    for (let col = colMin; col <= colMax; col += 1) {
      // Nearest point of the tile to the centre, in degrees scaled to metres.
      const nearLat = Math.min(Math.max(lat, row * TILE_SIZE_DEG), (row + 1) * TILE_SIZE_DEG);
      const nearLng = Math.min(Math.max(lng, col * TILE_SIZE_DEG), (col + 1) * TILE_SIZE_DEG);
      const dy = (nearLat - lat) * 111_320;
      const dx = (nearLng - lng) * 111_320 * Math.cos((lat * Math.PI) / 180);
      if (Math.hypot(dx, dy) <= radiusM) tiles.push(`${row}_${col}`);
    }
  }
  return tiles;
}
