import { describe, expect, it } from "vitest";
import { mediaKindOf } from "./media.ts";
import { areaOutlooks, describeOutlook, type OutlookIncident } from "./outlook.ts";

const NOW = new Date("2026-10-01T12:00:00Z");
const day = (n: number, hourUtc = 19) => new Date(Date.UTC(2026, 9, 1 - n, hourUtc)).toISOString();

describe("area outlook", () => {
  it("gives nothing for areas with only a few reports", () => {
    const few: OutlookIncident[] = [1, 2, 3, 4].map((n) => ({
      cell: "a",
      severity: "critical",
      at: day(n * 7),
    }));
    expect(areaOutlooks(few, NOW)).toEqual([]);
  });

  it("finds the level, the busy time and the trend", () => {
    // Fridays at 20:00 Lagos time, recent weeks only: rising.
    const fridays = [2, 9, 16, 23].map((n) => ({
      cell: "b",
      severity: "high" as const,
      at: new Date(Date.UTC(2026, 8, 25 - n + 2, 19)).toISOString(),
    }));
    const others = [40, 70].map((n) => ({
      cell: "b",
      severity: "standard" as const,
      at: day(n, 9),
    }));
    const [outlook] = areaOutlooks([...fridays, ...others], NOW);
    expect(outlook).toMatchObject({ cell: "b", incidents: 6, level: "moderate", trend: "rising" });
    expect(outlook?.peak).toEqual({ day: "Friday", band: "evening" });
    if (!outlook) throw new Error("no outlook");
    expect(describeOutlook(outlook)).toBe(
      "Some reports here in the last 3 months, most on Friday evenings. More than before lately.",
    );
  });

  it("ignores reports older than three months", () => {
    const old = [100, 110, 120, 130, 140].map((n) => ({
      cell: "c",
      severity: "critical" as const,
      at: day(n),
    }));
    expect(areaOutlooks(old, NOW)).toEqual([]);
  });
});

describe("media types", () => {
  it("knows the accepted types", () => {
    expect(mediaKindOf("audio/mp4")).toBe("audio");
    expect(mediaKindOf("image/jpeg; charset=binary")).toBe("photo");
    expect(mediaKindOf("video/mp4")).toBe("video");
    expect(mediaKindOf("application/pdf")).toBeNull();
    expect(mediaKindOf(undefined)).toBeNull();
  });
});
