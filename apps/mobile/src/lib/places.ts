// Saved places (home, work, school...). They are stored only on this phone and never sent to
// the server: the app asks for alerts by coarse tiles and does the matching itself.

import type { KeyValueStore } from "./outbox.ts";

export const PLACE_KINDS = ["home", "work", "school", "family", "other"] as const;
export type PlaceKind = (typeof PLACE_KINDS)[number];

export const PLACE_KIND_LABEL: Record<PlaceKind, string> = {
  home: "Home",
  work: "Work",
  school: "School",
  family: "Family",
  other: "Other",
};

export const PLACE_ICONS: Record<PlaceKind, string> = {
  home: "home",
  work: "briefcase",
  school: "school",
  family: "account-heart",
  other: "map-marker",
};

export interface SavedPlace {
  id: string;
  name: string;
  kind: PlaceKind;
  lat: number;
  lng: number;
}

/** Five places of nine tiles each stays within what the alert feed accepts in one request. */
export const MAX_PLACES = 5;
export const MAX_PLACE_NAME = 40;

const PLACES_KEY = "warden.places.v1";
const LAST_AREA_KEY = "warden.lastArea.v1";

function isPlace(value: unknown): value is SavedPlace {
  if (!value || typeof value !== "object") return false;
  const p = value as Record<string, unknown>;
  return (
    typeof p.id === "string" &&
    typeof p.name === "string" &&
    typeof p.lat === "number" &&
    typeof p.lng === "number" &&
    PLACE_KINDS.includes(p.kind as PlaceKind)
  );
}

export async function loadPlaces(store: KeyValueStore): Promise<SavedPlace[]> {
  const raw = await store.getItem(PLACES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPlace).slice(0, MAX_PLACES) : [];
  } catch {
    return [];
  }
}

export async function savePlaces(store: KeyValueStore, places: SavedPlace[]): Promise<void> {
  await store.setItem(PLACES_KEY, JSON.stringify(places.slice(0, MAX_PLACES)));
}

/**
 * Where the phone was the last time the app had a location, for "alert me where I am".
 * Rounded to about 100 m: enough for alerts, and less sensitive if the phone is lost.
 */
export interface LastArea {
  lat: number;
  lng: number;
  at: string;
}

export async function saveLastArea(
  store: KeyValueStore,
  point: { lat: number; lng: number },
  now: Date,
): Promise<void> {
  const round = (n: number) => Math.round(n * 1_000) / 1_000;
  const area: LastArea = { lat: round(point.lat), lng: round(point.lng), at: now.toISOString() };
  await store.setItem(LAST_AREA_KEY, JSON.stringify(area));
}

export async function loadLastArea(store: KeyValueStore): Promise<LastArea | null> {
  const raw = await store.getItem(LAST_AREA_KEY);
  if (!raw) return null;
  try {
    const area = JSON.parse(raw) as LastArea;
    return typeof area.lat === "number" && typeof area.lng === "number" ? area : null;
  } catch {
    return null;
  }
}

export async function clearLastArea(store: KeyValueStore): Promise<void> {
  await store.removeItem(LAST_AREA_KEY);
}
