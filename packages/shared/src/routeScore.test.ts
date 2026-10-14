import { describe, expect, it } from "vitest";
import { tipWarnings } from "./community.ts";
import { distanceToSegment, routeArea, routeScore, type ScoredIncident } from "./routeScore.ts";

const NOW = new Date("2026-10-01T12:00:00Z");
const IKEJA = { lat: 6.6, lng: 3.35 };
const YABA = { lat: 6.5, lng: 3.38 };

function incident(over: Partial<ScoredIncident>): ScoredIncident {
  return {
    id: "i",
    categoryId: "armed_robbery",
    severity: "critical",
    label: "Verified",
    active: true,
    lastReportAt: new Date(NOW.getTime() - 3_600_000).toISOString(),
    center: { lat: 6.55, lng: 3.365 },
    ...over,
  };
}

describe("route safety score", () => {
  it("is calm with nothing on the way", () => {
    expect(routeScore([], IKEJA, YABA, NOW)).toEqual({ score: 100, level: "calm", nearby: [] });
  });

  it("counts recent serious incidents near the line, worst first", () => {
    const result = routeScore(
      [
        incident({ id: "robbery" }),
        incident({ id: "theft", severity: "standard", categoryId: "theft" }),
        // Far from the line: ignored.
        incident({ id: "far", center: { lat: 6.55, lng: 3.5 } }),
        // A month old: ignored.
        incident({ id: "old", lastReportAt: "2026-09-01T00:00:00Z" }),
      ],
      IKEJA,
      YABA,
      NOW,
    );
    expect(result.nearby.map((n) => n.id)).toEqual(["robbery", "theft"]);
    expect(result.score).toBe(52);
    expect(result.level).toBe("caution");
  });

  it("says avoid when several serious incidents are on the way", () => {
    const many = [1, 2, 3].map((n) => incident({ id: `r${n}` }));
    expect(routeScore(many, IKEJA, YABA, NOW).level).toBe("avoid");
  });

  it("measures distance to the segment, not the endless line", () => {
    expect(distanceToSegment(IKEJA, IKEJA, YABA)).toBeLessThan(1);
    const beyond = { lat: 6.4, lng: 3.41 };
    expect(distanceToSegment(beyond, IKEJA, YABA)).toBeGreaterThan(10_000);
    const area = routeArea(IKEJA, YABA);
    expect(area.minLat).toBeLessThan(6.5);
    expect(area.maxLng).toBeGreaterThan(3.38);
  });
});

describe("tip warnings", () => {
  it("points out personal details for the moderator", () => {
    expect(tipWarnings("Avoid the junction at night, two robberies this week")).toEqual([]);
    expect(tipWarnings("Call 0803 123 4567 for the guy")).toContain("Contains a phone number");
    expect(tipWarnings("he lives at house 12")).toContain("May give an exact address");
    expect(tipWarnings("see www.example.com")).toContain("Contains a link");
    expect(tipWarnings("follow @someone")).toContain("Mentions a social media account");
  });
});
