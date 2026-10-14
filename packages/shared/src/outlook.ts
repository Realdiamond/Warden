// Area outlook (M8): a plain estimate of how often serious things have been reported in an area,
// and when. Adapted from the v1 "AI risk prediction": no model scores people or predicts
// individual crimes. It counts past public incidents in areas a few kilometres across, so it
// can be explained in one sentence and checked by anyone.
//
// Areas with few incidents get no outlook at all, so a single report cannot mark a street.

import type { Severity } from "./categories.ts";

export const OUTLOOK_DAYS = 90;
export const OUTLOOK_MIN_INCIDENTS = 5;
export const OUTLOOK_RECENT_DAYS = 30;

export type OutlookLevel = "low" | "moderate" | "elevated";
export type OutlookTrend = "rising" | "steady" | "falling";
export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;
export const TIME_BANDS = ["night", "morning", "afternoon", "evening"] as const;
export type TimeBand = (typeof TIME_BANDS)[number];

export interface OutlookIncident {
  /** H3 resolution-7 cell. */
  cell: string;
  severity: Severity;
  at: string;
}

export interface AreaOutlook {
  cell: string;
  level: OutlookLevel;
  trend: OutlookTrend;
  incidents: number;
  /** The busiest time, when it stands out (at least a third of incidents). */
  peak: { day: (typeof DAY_NAMES)[number] | null; band: TimeBand } | null;
}

export interface PublicAreaOutlook extends AreaOutlook {
  center: { lat: number; lng: number };
  boundary: Array<[number, number]>;
}

const WEIGHT: Record<Severity, number> = { critical: 3, high: 2, standard: 1 };
const DAY_MS = 86_400_000;
/** Nigeria is UTC+1 all year. */
const WAT_OFFSET_MS = 3_600_000;

function localParts(iso: string): { day: number; band: TimeBand } {
  const local = new Date(new Date(iso).getTime() + WAT_OFFSET_MS);
  const hour = local.getUTCHours();
  const band: TimeBand =
    hour < 6 ? "night" : hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  return { day: local.getUTCDay(), band };
}

function mostCommon<T>(values: T[]): { value: T; count: number } | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: { value: T; count: number } | null = null;
  for (const [value, count] of counts) if (!best || count > best.count) best = { value, count };
  return best;
}

export function areaOutlooks(incidents: OutlookIncident[], now: Date): AreaOutlook[] {
  const since = now.getTime() - OUTLOOK_DAYS * DAY_MS;
  const recentSince = now.getTime() - OUTLOOK_RECENT_DAYS * DAY_MS;
  const byCell = new Map<string, OutlookIncident[]>();
  for (const incident of incidents) {
    const t = new Date(incident.at).getTime();
    if (t < since || t > now.getTime()) continue;
    const list = byCell.get(incident.cell) ?? [];
    list.push(incident);
    byCell.set(incident.cell, list);
  }

  const result: AreaOutlook[] = [];
  for (const [cell, list] of byCell) {
    if (list.length < OUTLOOK_MIN_INCIDENTS) continue;
    // Weighted incidents per 30 days.
    const weighted = list.reduce((sum, i) => sum + WEIGHT[i.severity], 0);
    const perMonth = (weighted * OUTLOOK_RECENT_DAYS) / OUTLOOK_DAYS;
    const level: OutlookLevel = perMonth >= 8 ? "elevated" : perMonth >= 3 ? "moderate" : "low";

    const recent = list.filter((i) => new Date(i.at).getTime() >= recentSince).length;
    const earlierPerMonth =
      ((list.length - recent) * OUTLOOK_RECENT_DAYS) / (OUTLOOK_DAYS - OUTLOOK_RECENT_DAYS);
    const trend: OutlookTrend =
      recent >= earlierPerMonth * 1.5 + 1
        ? "rising"
        : recent <= earlierPerMonth * 0.5 - 1
          ? "falling"
          : "steady";

    const parts = list.map((i) => localParts(i.at));
    const band = mostCommon(parts.map((p) => p.band));
    const slot = mostCommon(parts.map((p) => `${p.day}:${p.band}`));
    let peak: AreaOutlook["peak"] = null;
    if (slot && slot.count * 3 >= list.length && slot.count >= 3) {
      const [day, slotBand] = slot.value.split(":");
      peak = { day: DAY_NAMES[Number(day)] ?? null, band: slotBand as TimeBand };
    } else if (band && band.count * 2 >= list.length) {
      peak = { day: null, band: band.value };
    }
    result.push({ cell, level, trend, incidents: list.length, peak });
  }
  return result.sort((a, b) => b.incidents - a.incidents);
}

/** One sentence for people, e.g. "More reports than usual, mostly on Friday evenings." */
export function describeOutlook(outlook: AreaOutlook): string {
  const level =
    outlook.level === "elevated"
      ? "Many serious reports here in the last 3 months"
      : outlook.level === "moderate"
        ? "Some reports here in the last 3 months"
        : "Few reports here in the last 3 months";
  const when = outlook.peak
    ? outlook.peak.day
      ? `, most on ${outlook.peak.day} ${outlook.peak.band === "night" ? "nights" : `${outlook.peak.band}s`}`
      : `, most in the ${outlook.peak.band === "night" ? "night" : outlook.peak.band}`
    : "";
  const trend =
    outlook.trend === "rising"
      ? " More than before lately."
      : outlook.trend === "falling"
        ? " Fewer lately."
        : "";
  return `${level}${when}.${trend}`;
}

/** GET /v1/areas/outlook */
export interface AreaOutlooksResponse {
  outlooks: PublicAreaOutlook[];
  generatedAt: string;
}
