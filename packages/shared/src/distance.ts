// Distance helpers that run on the phone: the app sends only a distance band, never the
// reporter's own position (Security tab, "proximity without location").

import type { ProximityBand } from "./schemas.ts";

const EARTH_RADIUS_M = 6_371_008.8;

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

export interface LatLng {
  lat: number;
  lng: number;
}

export function distanceMeters(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function proximityBand(reporter: LatLng | null, incident: LatLng): ProximityBand {
  if (!reporter) return "unknown";
  const meters = distanceMeters(reporter, incident);
  if (meters < 500) return "here";
  if (meters < 2_000) return "near";
  return "far";
}
