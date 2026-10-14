import { describe, expect, it } from "vitest";
import { distanceMeters } from "./distance.ts";
import {
  answerCheckIn,
  newRouteWatch,
  ROUTE_SUSTAIN_MS,
  type RouteWatch,
  updateRouteWatch,
} from "./route.ts";

// Ikeja to Lekki: about 20 km in a straight line.
const IKEJA = { lat: 6.6018, lng: 3.3515 };
const LEKKI = { lat: 6.4474, lng: 3.4723 };
const T0 = new Date("2026-10-14T18:00:00Z").getTime();
const at = (minutes: number) => new Date(T0 + minutes * 60_000).toISOString();

/** A point on the line from Ikeja towards Lekki (share 0..1), or beyond Ikeja (negative). */
function along(share: number) {
  return {
    lat: IKEJA.lat + (LEKKI.lat - IKEJA.lat) * share,
    lng: IKEJA.lng + (LEKKI.lng - IKEJA.lng) * share,
  };
}

function feed(watch: RouteWatch, points: Array<[number, number, number?]>) {
  let current = watch;
  const statuses: string[] = [];
  for (const [share, minute, accuracyM] of points) {
    const result = updateRouteWatch(current, { ...along(share), accuracyM, at: at(minute) });
    current = result.watch;
    statuses.push(result.status);
  }
  return { watch: current, statuses };
}

describe("off-route checks", () => {
  it("stays quiet while the person keeps getting closer", () => {
    const { statuses } = feed(newRouteWatch(LEKKI), [
      [0, 0],
      [0.2, 5],
      [0.5, 15],
      [0.8, 25],
      [1, 35],
    ]);
    expect(statuses).toEqual(["on_course", "on_course", "on_course", "on_course", "near"]);
  });

  it("asks once after the person keeps moving away, and only after a few minutes", () => {
    const { watch, statuses } = feed(newRouteWatch(LEKKI), [
      [0, 0],
      [0.4, 10], // 8 km closer
      [0.1, 20], // back 6 km: beyond the 5 km margin (a quarter of 20 km)
      [0.05, 22],
      [0, 20 + ROUTE_SUSTAIN_MS / 60_000],
      [-0.1, 30],
    ]);
    expect(statuses).toEqual(["on_course", "on_course", "drifting", "drifting", "ask", "waiting"]);
    expect(watch.asked).toBe(true);
  });

  it("forgets a short detour that comes back on course", () => {
    const { statuses, watch } = feed(newRouteWatch(LEKKI), [
      [0, 0],
      [0.4, 10],
      [0.1, 12],
      [0.45, 14],
    ]);
    expect(statuses).toEqual(["on_course", "on_course", "drifting", "on_course"]);
    expect(watch.awaySince).toBeNull();
  });

  it("ignores inaccurate positions", () => {
    const { statuses } = feed(newRouteWatch(LEKKI), [
      [0, 0],
      [0.4, 10],
      [-0.5, 12, 900],
      [-0.5, 20, 900],
    ]);
    expect(statuses).toEqual(["on_course", "on_course", "on_course", "on_course"]);
  });

  it("starts again from the current position once the person says they are OK", () => {
    const asked = feed(newRouteWatch(LEKKI), [
      [0, 0],
      [0.4, 10],
      [0.1, 20],
      [0.1, 25],
    ]);
    expect(asked.statuses.at(-1)).toBe("ask");
    const here = distanceMeters(along(0.1), LEKKI);
    const after = feed(answerCheckIn(asked.watch, here), [
      [0.1, 26],
      [0.3, 35],
    ]);
    expect(after.statuses).toEqual(["on_course", "on_course"]);
  });

  it("uses at least 1.5 km of margin on short trips", () => {
    const shortTrip = newRouteWatch(along(0.05)); // about 1 km away
    const { statuses } = feed(shortTrip, [
      [0, 0],
      [-0.03, 3], // about 600 m further away
      [-0.03, 10],
    ]);
    expect(statuses).toEqual(["on_course", "on_course", "on_course"]);
  });
});
