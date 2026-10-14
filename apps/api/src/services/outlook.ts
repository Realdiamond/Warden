// Area outlook (M8, see packages/shared/src/outlook.ts): counts of past public incidents per
// area, computed on request from the same incidents the public map shows. Disputed and
// removed incidents never count.

import {
  type AreaOutlook,
  areaOutlooks,
  type BBox,
  OUTLOOK_DAYS,
  type PublicAreaOutlook,
  type Severity,
} from "@warden/shared";
import { cellBoundary, cellCenter, cellsFor } from "@warden/shared/geo";
import type { ServiceDeps } from "./deps.ts";

export const COUNTED_STATES = ["unconfirmed", "verified", "resolved"];

export async function outlookFor(deps: ServiceDeps, bbox: BBox): Promise<PublicAreaOutlook[]> {
  const now = deps.now();
  const { rows } = await deps.pool.query<{
    severity: Severity;
    first_reported_at: Date;
    lat: number;
    lng: number;
  }>(
    `SELECT severity, first_reported_at, ST_Y(public_point) AS lat, ST_X(public_point) AS lng
       FROM incidents
      WHERE handling = 'public'
        AND state = ANY($1::text[])
        AND publish_after IS NOT NULL AND publish_after <= $2
        AND first_reported_at >= $3
        AND public_point && ST_MakeEnvelope($4, $5, $6, $7, 4326)
      LIMIT 20000`,
    [
      COUNTED_STATES,
      now,
      new Date(now.getTime() - OUTLOOK_DAYS * 86_400_000),
      bbox.minLng,
      bbox.minLat,
      bbox.maxLng,
      bbox.maxLat,
    ],
  );
  const outlooks: AreaOutlook[] = areaOutlooks(
    rows.map((row) => ({
      cell: cellsFor(row.lat, row.lng).r7,
      severity: row.severity,
      at: row.first_reported_at.toISOString(),
    })),
    now,
  );
  return outlooks.map((o) => ({
    ...o,
    center: cellCenter(o.cell),
    boundary: cellBoundary(o.cell),
  }));
}
