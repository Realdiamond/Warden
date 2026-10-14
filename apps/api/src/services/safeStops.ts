// Safe stops (M6): police stations, hospitals, fuel stations and other public places, imported
// from OpenStreetMap exports or partner lists. Public places, so exact points are public.

import { randomUUID } from "node:crypto";
import {
  type BBox,
  isInNigeria,
  kindFromOsmTags,
  SAFE_STOP_KINDS,
  type SafeStop,
  type SafeStopKind,
} from "@warden/shared";
import { type Pool, withTransaction } from "../db/pool.ts";
import { appendAudit } from "./audit.ts";

const MAX_STOPS = 300;

interface StopRow {
  id: string;
  kind: SafeStopKind;
  name: string;
  lat: number;
  lng: number;
  phone: string | null;
  open_24h: boolean;
  verified: boolean;
}

export async function safeStopsIn(pool: Pool, bbox: BBox): Promise<SafeStop[]> {
  const { rows } = await pool.query<StopRow>(
    `SELECT id, kind, name, ST_Y(location) AS lat, ST_X(location) AS lng, phone, open_24h, verified
       FROM safe_stops
      WHERE removed_at IS NULL
        AND location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
      ORDER BY verified DESC, kind, name
      LIMIT $5`,
    [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat, MAX_STOPS],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    name: row.name,
    lat: row.lat,
    lng: row.lng,
    phone: row.phone,
    open24h: row.open_24h,
    verified: row.verified,
  }));
}

export interface StopInput {
  kind: SafeStopKind;
  name: string;
  lat: number;
  lng: number;
  phone: string | null;
  open24h: boolean;
  sourceRef: string;
}

/**
 * Reads a GeoJSON FeatureCollection of points: an OpenStreetMap export (amenity tags) or a
 * partner list with a "kind" property. Features that are not safe stops, have no name or lie
 * outside Nigeria are skipped.
 */
export function stopsFromGeoJson(geojson: unknown): { stops: StopInput[]; skipped: number } {
  const features = (geojson as { features?: unknown[] })?.features;
  if (!Array.isArray(features)) throw new Error("Expected a GeoJSON FeatureCollection");
  const stops: StopInput[] = [];
  let skipped = 0;
  for (const raw of features) {
    const feature = raw as {
      id?: string | number;
      geometry?: { type?: string; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const props = Object.fromEntries(
      Object.entries(feature.properties ?? {}).map(([k, v]) => [
        k,
        typeof v === "string" ? v : undefined,
      ]),
    );
    const coords = feature.geometry?.coordinates;
    const kind =
      props.kind && (SAFE_STOP_KINDS as readonly string[]).includes(props.kind)
        ? (props.kind as SafeStopKind)
        : kindFromOsmTags(props);
    const name = props.name?.trim();
    const ref = String(feature.id ?? props["@id"] ?? props.id ?? "");
    if (
      feature.geometry?.type !== "Point" ||
      !Array.isArray(coords) ||
      typeof coords[0] !== "number" ||
      typeof coords[1] !== "number" ||
      !kind ||
      !name ||
      !ref ||
      !isInNigeria(coords[1], coords[0])
    ) {
      skipped += 1;
      continue;
    }
    stops.push({
      kind,
      name: name.slice(0, 120),
      lat: coords[1],
      lng: coords[0],
      phone: (props.phone ?? props["contact:phone"])?.slice(0, 40) ?? null,
      open24h: props.opening_hours === "24/7" || props.open_24h === "yes",
      sourceRef: ref.slice(0, 120),
    });
  }
  return { stops, skipped };
}

/** Adds or updates stops from one source, keyed by the source's own id. */
export async function importSafeStops(
  deps: { pool: Pool; now: () => Date },
  source: "osm" | "partner" | "manual" | "demo",
  stops: StopInput[],
  options: { verified: boolean; actor: string },
): Promise<number> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    for (const stop of stops) {
      await client.query(
        `INSERT INTO safe_stops
           (id, kind, name, location, phone, open_24h, source, source_ref, verified, created_at, updated_at)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326), $6, $7, $8, $9, $10, $11, $11)
         ON CONFLICT (source, source_ref) DO UPDATE
           SET kind = EXCLUDED.kind, name = EXCLUDED.name, location = EXCLUDED.location,
               phone = EXCLUDED.phone, open_24h = EXCLUDED.open_24h,
               verified = safe_stops.verified OR EXCLUDED.verified,
               updated_at = EXCLUDED.updated_at, removed_at = NULL`,
        [
          randomUUID(),
          stop.kind,
          stop.name,
          stop.lng,
          stop.lat,
          stop.phone,
          stop.open24h,
          source,
          stop.sourceRef,
          options.verified,
          now,
        ],
      );
    }
    await appendAudit(client, {
      at: now,
      actorType: "system",
      actorId: options.actor,
      action: "safe_stops.import",
      objectType: "safe_stops",
      objectId: source,
      details: { count: stops.length, verified: options.verified },
    });
    return stops.length;
  });
}
