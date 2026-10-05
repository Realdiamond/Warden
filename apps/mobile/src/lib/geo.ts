import { type BBox, MAX_BBOX_SPAN_DEG, type PublicIncident } from "@warden/shared";

/** Map bounds come as [west, south, east, north]; the API accepts at most a 6° box. */
export function boundsToBBox(bounds: readonly [number, number, number, number]): BBox {
  const [west, south, east, north] = bounds;
  const centerLng = (west + east) / 2;
  const centerLat = (south + north) / 2;
  const halfLng = Math.min((east - west) / 2, MAX_BBOX_SPAN_DEG / 2 - 0.001);
  const halfLat = Math.min((north - south) / 2, MAX_BBOX_SPAN_DEG / 2 - 0.001);
  return {
    minLng: Math.max(-180, centerLng - halfLng),
    minLat: Math.max(-90, centerLat - halfLat),
    maxLng: Math.min(180, centerLng + halfLng),
    maxLat: Math.min(90, centerLat + halfLat),
  };
}

export function incidentsToGeoJSON(
  incidents: readonly PublicIncident[],
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: incidents.map((incident) => ({
      type: "Feature",
      id: incident.id,
      properties: {
        id: incident.id,
        severity: incident.severity,
        active: incident.active,
        label: incident.label,
      },
      geometry: { type: "Polygon", coordinates: [incident.boundary] },
    })),
  };
}

export function insideBBox(point: { lat: number; lng: number }, bbox: BBox): boolean {
  return (
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat &&
    point.lng >= bbox.minLng &&
    point.lng <= bbox.maxLng
  );
}
