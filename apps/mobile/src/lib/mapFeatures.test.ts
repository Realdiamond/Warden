import type { PublicIncident } from "@warden/shared";
import { describe, expect, it } from "vitest";
import {
  incidentName,
  incidentPoints,
  NEAR_RADIUS_M,
  nearSummary,
  SEVERITY_RANK,
  shortAge,
} from "./mapFeatures.ts";

const HOME = { lat: 6.6018, lng: 3.3515 };

function incident(
  id: string,
  offsetMeters: number,
  overrides: Partial<PublicIncident> = {},
): PublicIncident {
  // About 111 km per degree of latitude.
  const lat = HOME.lat + offsetMeters / 111_000;
  return {
    id,
    categoryId: "phone_snatching",
    severity: "high",
    label: "Unconfirmed",
    reportCount: 1,
    firstReportedAt: "2026-11-04T10:00:00Z",
    lastReportAt: "2026-11-04T10:00:00Z",
    active: true,
    cell: "88754e64dffffff",
    center: { lat, lng: HOME.lng },
    boundary: [],
    responder: null,
    ...overrides,
  } as PublicIncident;
}

describe("near you", () => {
  it("is quiet with nothing around", () => {
    expect(nearSummary([incident("far", 5_000)], HOME)).toEqual({ level: "quiet", count: 0 });
  });

  it("asks people to take care when something is going on within a kilometre", () => {
    const summary = nearSummary(
      [incident("a", 300), incident("b", 900), incident("c", 2_000)],
      HOME,
    );
    expect(summary).toEqual({ level: "caution", count: 2 });
  });

  it("says danger only for an emergency that is still going on", () => {
    expect(nearSummary([incident("a", 200, { severity: "critical" })], HOME).level).toBe("danger");
    expect(
      nearSummary([incident("a", 200, { severity: "critical", active: false })], HOME).level,
    ).toBe("quiet");
  });

  it("counts incidents that are over but does not raise the level for them", () => {
    expect(nearSummary([incident("a", 100, { active: false })], HOME)).toEqual({
      level: "quiet",
      count: 1,
    });
  });

  it("uses a one kilometre radius", () => {
    expect(NEAR_RADIUS_M).toBe(1000);
    expect(nearSummary([incident("edge", 1_050)], HOME).count).toBe(0);
  });
});

describe("map markers", () => {
  it("puts one point per incident at its public area centre", () => {
    const points = incidentPoints(
      [incident("a", 0, { severity: "critical", reportCount: 3, active: false })],
      (i) => `${incidentName(i)} · 40 min`,
    );
    const [feature] = points.features;
    expect(feature?.geometry.coordinates).toEqual([HOME.lng, HOME.lat]);
    expect(feature?.properties).toEqual({
      id: "a",
      rank: SEVERITY_RANK.critical,
      active: 0,
      icon: "cellphone",
      reports: 3,
      title: "Phone snatching · 40 min",
    });
  });

  it("orders severities so clusters can take the most serious colour", () => {
    expect(SEVERITY_RANK.critical).toBeGreaterThan(SEVERITY_RANK.high);
    expect(SEVERITY_RANK.high).toBeGreaterThan(SEVERITY_RANK.standard);
  });

  it("writes short ages for labels", () => {
    const now = Date.parse("2026-11-04T12:00:00Z");
    expect(shortAge("2026-11-04T11:59:50Z", now)).toBe("1 min");
    expect(shortAge("2026-11-04T11:20:00Z", now)).toBe("40 min");
    expect(shortAge("2026-11-04T09:00:00Z", now)).toBe("3 h");
    expect(shortAge("2026-11-01T12:00:00Z", now)).toBe("3 d");
  });
});
