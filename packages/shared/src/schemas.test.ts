import { describe, expect, it } from "vitest";
import { proximityBand } from "./distance.ts";
import { cellBoundary, cellsFor, isInNigeria, nearbyCells, publicCellFor } from "./geo.ts";
import { MapQuerySchema, ModerationDecisionSchema, ReportSubmissionSchema } from "./schemas.ts";

const lagos = { lat: 6.5244, lng: 3.3792 };

describe("ReportSubmissionSchema", () => {
  it("accepts a minimal report and defaults proximity", () => {
    const parsed = ReportSubmissionSchema.parse({ categoryId: "theft", location: lagos });
    expect(parsed.proximity).toBe("unknown");
  });

  it("rejects unknown categories and extra fields", () => {
    expect(ReportSubmissionSchema.safeParse({ categoryId: "nope", location: lagos }).success).toBe(
      false,
    );
    expect(
      ReportSubmissionSchema.safeParse({ categoryId: "theft", location: lagos, reporterName: "x" })
        .success,
    ).toBe(false);
  });

  it("trims and limits the description", () => {
    const parsed = ReportSubmissionSchema.parse({
      categoryId: "theft",
      location: lagos,
      description: "  hi  ",
    });
    expect(parsed.description).toBe("hi");
    const long = "a".repeat(501);
    expect(
      ReportSubmissionSchema.safeParse({ categoryId: "theft", location: lagos, description: long })
        .success,
    ).toBe(false);
  });
});

describe("MapQuerySchema", () => {
  it("parses a bbox and filters unknown categories", () => {
    const q = MapQuerySchema.parse({ bbox: "3.2,6.4,3.6,6.7", categories: "theft,bogus" });
    expect(q.bbox).toEqual({ minLng: 3.2, minLat: 6.4, maxLng: 3.6, maxLat: 6.7 });
    expect(q.window).toBe("24h");
    expect(q.categories).toEqual(["theft"]);
  });

  it.each(["1,2,3", "a,b,c,d", "3.6,6.4,3.2,6.7", "0,0,10,10"])("rejects bbox %s", (bbox) => {
    expect(MapQuerySchema.safeParse({ bbox }).success).toBe(false);
  });
});

describe("ModerationDecisionSchema", () => {
  it("requires a reason to remove or hold", () => {
    expect(ModerationDecisionSchema.safeParse({ action: "remove" }).success).toBe(false);
    expect(
      ModerationDecisionSchema.safeParse({ action: "remove", reason: "false report" }).success,
    ).toBe(true);
    expect(ModerationDecisionSchema.safeParse({ action: "verify" }).success).toBe(true);
  });
});

describe("geo", () => {
  it("knows Lagos and Abuja are in Nigeria and Accra is not", () => {
    expect(isInNigeria(lagos.lat, lagos.lng)).toBe(true);
    expect(isInNigeria(9.0765, 7.3986)).toBe(true);
    expect(isInNigeria(5.6037, -0.187)).toBe(false);
  });

  it("uses the wider cell for critical incidents", () => {
    const cells = cellsFor(lagos.lat, lagos.lng);
    expect(publicCellFor(cells, "critical")).toBe(cells.r8);
    expect(publicCellFor(cells, "standard")).toBe(cells.r9);
  });

  it("returns a closed boundary ring and 7 nearby cells", () => {
    const { r9 } = cellsFor(lagos.lat, lagos.lng);
    const ring = cellBoundary(r9);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    expect(nearbyCells(r9)).toHaveLength(7);
  });
});

describe("proximityBand", () => {
  it("bands distances without revealing the reporter's position", () => {
    expect(proximityBand(null, lagos)).toBe("unknown");
    expect(proximityBand(lagos, { lat: 6.526, lng: 3.38 })).toBe("here");
    expect(proximityBand(lagos, { lat: 6.535, lng: 3.38 })).toBe("near");
    expect(proximityBand(lagos, { lat: 6.6, lng: 3.38 })).toBe("far");
  });
});
