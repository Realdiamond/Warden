// H3 helpers (server-side; imported as "@warden/shared/geo" so the app bundle stays small).

import { cellToBoundary, cellToLatLng, gridDisk, latLngToCell } from "h3-js";
import type { Severity } from "./categories.ts";
import { publicResolution } from "./rules.ts";
import type { Ring } from "./types.ts";

/** Generous bounding box around Nigeria (about 4.27°N–13.89°N, 2.67°E–14.68°E). */
export const NIGERIA_BOUNDS = { minLat: 4.0, maxLat: 14.0, minLng: 2.6, maxLng: 14.8 } as const;

export function isInNigeria(lat: number, lng: number): boolean {
  return (
    lat >= NIGERIA_BOUNDS.minLat &&
    lat <= NIGERIA_BOUNDS.maxLat &&
    lng >= NIGERIA_BOUNDS.minLng &&
    lng <= NIGERIA_BOUNDS.maxLng
  );
}

export interface Cells {
  r7: string;
  r8: string;
  r9: string;
}

export function cellsFor(lat: number, lng: number): Cells {
  return {
    r7: latLngToCell(lat, lng, 7),
    r8: latLngToCell(lat, lng, 8),
    r9: latLngToCell(lat, lng, 9),
  };
}

export function publicCellFor(cells: Cells, severity: Severity): string {
  return publicResolution(severity) === 8 ? cells.r8 : cells.r9;
}

export function cellCenter(cell: string): { lat: number; lng: number } {
  const [lat, lng] = cellToLatLng(cell);
  return { lat, lng };
}

/** Closed ring in [lng, lat] order, ready for GeoJSON. */
export function cellBoundary(cell: string): Ring {
  const ring = cellToBoundary(cell, true) as Ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1]))
    ring.push([first[0], first[1]]);
  return ring;
}

/** The cell and its immediate neighbours, used to merge nearby reports of one event. */
export function nearbyCells(cell: string): string[] {
  return gridDisk(cell, 1);
}
