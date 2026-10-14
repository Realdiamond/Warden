// Off-route checks for trips (M6). The phone compares each position with the trip's destination
// and asks the person "Are you OK?" when they keep moving away from it. Contacts are told only
// if the person does not answer. Pure functions, so the rules can be tested without a phone.
//
// Deliberately cautious, because GPS on low-end phones is noisy and people take detours:
// - positions less accurate than MAX_ACCURACY_M are ignored;
// - "away" means the distance to the destination has grown by more than a margin over the
//   closest the person has been (at least 1.5 km, or a quarter of the trip's straight line);
// - it must stay that way for SUSTAIN_MS before the phone asks.

import { distanceMeters, type LatLng } from "./distance.ts";

export const ROUTE_MAX_ACCURACY_M = 100;
export const ROUTE_MIN_MARGIN_M = 1_500;
export const ROUTE_MARGIN_SHARE = 0.25;
export const ROUTE_SUSTAIN_MS = 4 * 60_000;
/** How long the person has to answer "Are you OK?" before contacts are told. */
export const CHECK_IN_WINDOW_MS = 5 * 60_000;
/** Close enough to the destination that no further checks are made. */
export const ROUTE_ARRIVED_M = 300;

export interface RouteWatch {
  destination: LatLng;
  /** Straight-line distance at the first good position. */
  startDistanceM: number | null;
  /** The closest the person has been to the destination. */
  closestM: number | null;
  /** When the person first moved beyond the margin, or null while on course. */
  awaySince: string | null;
  /** Set once the phone has asked; no more questions until the person answers. */
  asked: boolean;
}

export type RouteStatus = "on_course" | "drifting" | "ask" | "waiting" | "near";

export function newRouteWatch(destination: LatLng): RouteWatch {
  return { destination, startDistanceM: null, closestM: null, awaySince: null, asked: false };
}

export function routeMargin(watch: RouteWatch): number {
  return Math.max(ROUTE_MIN_MARGIN_M, ROUTE_MARGIN_SHARE * (watch.startDistanceM ?? 0));
}

/**
 * Feeds one position into the watch. "ask" is returned once, when the phone should ask the
 * person whether they are OK; after that "waiting" until {@link answerCheckIn} is called.
 */
export function updateRouteWatch(
  watch: RouteWatch,
  point: LatLng & { accuracyM?: number | null; at: string },
): { watch: RouteWatch; status: RouteStatus } {
  if (point.accuracyM !== undefined && point.accuracyM !== null) {
    if (point.accuracyM > ROUTE_MAX_ACCURACY_M) {
      return { watch, status: watch.asked ? "waiting" : "on_course" };
    }
  }
  const distance = distanceMeters(point, watch.destination);
  if (distance <= ROUTE_ARRIVED_M) {
    return { watch: { ...watch, closestM: distance, awaySince: null }, status: "near" };
  }
  const startDistanceM = watch.startDistanceM ?? distance;
  const closestM = Math.min(watch.closestM ?? distance, distance);
  const next: RouteWatch = { ...watch, startDistanceM, closestM };
  if (watch.asked) return { watch: next, status: "waiting" };

  const away = distance - closestM > routeMargin(next);
  if (!away) return { watch: { ...next, awaySince: null }, status: "on_course" };
  const awaySince = watch.awaySince ?? point.at;
  const sustained =
    new Date(point.at).getTime() - new Date(awaySince).getTime() >= ROUTE_SUSTAIN_MS;
  if (!sustained) return { watch: { ...next, awaySince }, status: "drifting" };
  return { watch: { ...next, awaySince, asked: true }, status: "ask" };
}

/**
 * The person said they are OK: the detour is accepted, so the closest distance starts again
 * from where they are now.
 */
export function answerCheckIn(watch: RouteWatch, currentDistanceM: number | null): RouteWatch {
  return {
    ...watch,
    asked: false,
    awaySince: null,
    closestM: currentDistanceM ?? watch.closestM,
  };
}
