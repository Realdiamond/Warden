// What the map shows (M10): a one-line answer to "is it safe near me?", and incidents as markers
// that group into numbered circles when zoomed out. Positions are the public area centres the
// server already gives everyone, never anything more exact.

import {
  distanceMeters,
  getCategory,
  type LatLng,
  type PublicIncident,
  type PublicPresence,
  publicLabelOf,
  type Severity,
} from "@warden/shared";

/** "Near you" means within this distance of the person (or of the middle of the map). */
export const NEAR_RADIUS_M = 1000;

export type NearLevel = "danger" | "caution" | "quiet";

export interface NearSummary {
  level: NearLevel;
  /** Incidents in the chosen time window whose area centre is within the radius. */
  count: number;
}

/**
 * Danger when an emergency is still going on nearby, take care when anything else is, quiet
 * otherwise. Incidents that are over still count towards the number, so "quiet" can sit beside
 * "2 reports", which is true and useful.
 */
export function nearSummary(
  incidents: readonly PublicIncident[],
  at: LatLng,
  radiusM: number = NEAR_RADIUS_M,
): NearSummary {
  const near = incidents.filter((incident) => distanceMeters(at, incident.center) <= radiusM);
  const live = near.filter((incident) => incident.active);
  const level: NearLevel = live.some((incident) => incident.severity === "critical")
    ? "danger"
    : live.length > 0
      ? "caution"
      : "quiet";
  return { level, count: near.length };
}

/** Higher is more serious; clusters take the colour of their most serious incident. */
export const SEVERITY_RANK: Record<Severity, number> = { critical: 3, high: 2, standard: 1 };

const FALLBACK_ICON = "alert-octagon";

/** One point per incident at its public area centre, for markers and clusters. */
export function incidentPoints(
  incidents: readonly PublicIncident[],
  title: (incident: PublicIncident) => string,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: incidents.map((incident) => ({
      type: "Feature",
      id: incident.id,
      properties: {
        id: incident.id,
        rank: SEVERITY_RANK[incident.severity],
        active: incident.active ? 1 : 0,
        icon: getCategory(incident.categoryId)?.icon ?? FALLBACK_ICON,
        reports: incident.reportCount,
        title: title(incident),
      },
      geometry: { type: "Point", coordinates: [incident.center.lng, incident.center.lat] },
    })),
  };
}

/** The category name the public sees for an incident, in English. */
export function incidentName(incident: PublicIncident): string {
  const category = getCategory(incident.categoryId);
  return category ? publicLabelOf(category) : "Incident";
}

/** "40 min", "3 h", "2 d": short enough for a map label. */
export function shortAge(iso: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.round(hours / 24)} d`;
}

/** Labels for responder deployments, placed at the middle of their area. */
export function presencePoints(
  presence: readonly PublicPresence[],
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: "FeatureCollection",
    features: presence.map((item) => ({
      type: "Feature",
      id: item.id,
      properties: { id: item.id, title: item.label },
      geometry: { type: "Point", coordinates: [item.center.lng, item.center.lat] },
    })),
  };
}
