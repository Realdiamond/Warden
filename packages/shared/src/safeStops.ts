// Safe stops (M6): public places to head for when something feels wrong, such as police
// stations, hospitals and 24-hour fuel stations. They are public places, so the app may show
// their exact points. Data comes from OpenStreetMap exports or partners, checked by Warden.

import { distanceMeters, type LatLng } from "./distance.ts";

export const SAFE_STOP_KINDS = [
  "police",
  "hospital",
  "clinic",
  "pharmacy",
  "fuel",
  "fire",
  "other",
] as const;
export type SafeStopKind = (typeof SAFE_STOP_KINDS)[number];

export const SAFE_STOP_LABELS: Record<SafeStopKind, string> = {
  police: "Police station",
  hospital: "Hospital",
  clinic: "Clinic",
  pharmacy: "Pharmacy",
  fuel: "Fuel station",
  fire: "Fire station",
  other: "Safe place",
};

export interface SafeStop {
  id: string;
  kind: SafeStopKind;
  name: string;
  lat: number;
  lng: number;
  phone: string | null;
  open24h: boolean;
  /** Checked by Warden or a partner, not only imported. */
  verified: boolean;
}

/** OpenStreetMap tags to a safe stop kind; null for places that are not safe stops. */
export function kindFromOsmTags(tags: Record<string, string | undefined>): SafeStopKind | null {
  switch (tags.amenity) {
    case "police":
      return "police";
    case "hospital":
      return "hospital";
    case "clinic":
    case "doctors":
      return "clinic";
    case "pharmacy":
      return "pharmacy";
    case "fuel":
      return "fuel";
    case "fire_station":
      return "fire";
    default:
      return tags.healthcare === "hospital" ? "hospital" : null;
  }
}

/** Police and hospitals first when equally close, since they can actually help. */
const KIND_PRIORITY: Record<SafeStopKind, number> = {
  police: 0,
  hospital: 0,
  fire: 1,
  clinic: 1,
  fuel: 2,
  pharmacy: 2,
  other: 3,
};

/** The closest stops, with a small preference for places that can help. */
export function nearestStops(
  stops: readonly SafeStop[],
  from: LatLng,
  count = 5,
): Array<SafeStop & { distanceM: number }> {
  return stops
    .map((stop) => ({ ...stop, distanceM: distanceMeters(from, stop) }))
    .sort(
      (a, b) =>
        a.distanceM * (1 + 0.15 * KIND_PRIORITY[a.kind]) -
        b.distanceM * (1 + 0.15 * KIND_PRIORITY[b.kind]),
    )
    .slice(0, count);
}

/** Sample stops for demo mode and demo servers. Not real places. */
export const DEMO_SAFE_STOPS: readonly SafeStop[] = [
  {
    id: "demo-stop-1",
    kind: "police",
    name: "Demo police station, Ikeja",
    lat: 6.6012,
    lng: 3.3502,
    phone: null,
    open24h: true,
    verified: false,
  },
  {
    id: "demo-stop-2",
    kind: "hospital",
    name: "Demo hospital, Ikeja",
    lat: 6.5935,
    lng: 3.3431,
    phone: null,
    open24h: true,
    verified: false,
  },
  {
    id: "demo-stop-3",
    kind: "fuel",
    name: "Demo 24-hour fuel station, Maryland",
    lat: 6.5713,
    lng: 3.3667,
    phone: null,
    open24h: true,
    verified: false,
  },
  {
    id: "demo-stop-4",
    kind: "police",
    name: "Demo police station, Yaba",
    lat: 6.5095,
    lng: 3.3711,
    phone: null,
    open24h: true,
    verified: false,
  },
  {
    id: "demo-stop-5",
    kind: "hospital",
    name: "Demo hospital, Lekki",
    lat: 6.4413,
    lng: 3.4733,
    phone: null,
    open24h: true,
    verified: false,
  },
  {
    id: "demo-stop-6",
    kind: "fire",
    name: "Demo fire station, Victoria Island",
    lat: 6.4311,
    lng: 3.4201,
    phone: null,
    open24h: true,
    verified: false,
  },
  {
    id: "demo-stop-7",
    kind: "police",
    name: "Demo police station, Wuse",
    lat: 9.0643,
    lng: 7.4789,
    phone: null,
    open24h: true,
    verified: false,
  },
  {
    id: "demo-stop-8",
    kind: "hospital",
    name: "Demo hospital, Garki",
    lat: 9.0331,
    lng: 7.4892,
    phone: null,
    open24h: true,
    verified: false,
  },
  {
    id: "demo-stop-9",
    kind: "pharmacy",
    name: "Demo pharmacy, Gwarinpa",
    lat: 9.1069,
    lng: 7.4045,
    phone: null,
    open24h: false,
    verified: false,
  },
];
