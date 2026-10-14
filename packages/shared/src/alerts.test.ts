import { describe, expect, it } from "vitest";
import {
  AlertsQuerySchema,
  communityOutcome,
  tierFor,
  tileFor,
  tilesAround,
  tilesForCircle,
} from "./alerts.ts";

describe("alert tiles", () => {
  it("puts nearby points in the same 0.1 degree tile", () => {
    expect(tileFor(6.5244, 3.3792)).toBe("65_33");
    expect(tileFor(6.5299, 3.3701)).toBe("65_33");
    expect(tileFor(-0.05, -0.05)).toBe("-1_-1");
  });

  it("covers the tile and its eight neighbours", () => {
    const tiles = tilesAround(6.5244, 3.3792);
    expect(tiles).toHaveLength(9);
    expect(new Set(tiles).size).toBe(9);
    expect(tiles).toContain("64_32");
    expect(tiles).toContain("66_34");
  });

  it("parses and de-duplicates a tile list", () => {
    const query = AlertsQuerySchema.parse({ tiles: "65_33, 65_33,64_32" });
    expect(query.tiles).toEqual(["65_33", "64_32"]);
    expect(() => AlertsQuerySchema.parse({ tiles: "65_33;drop" })).toThrow();
  });

  it("maps severity to tier", () => {
    expect(tierFor("critical")).toBe("critical");
    expect(tierFor("high")).toBe("warning");
    expect(tierFor("standard")).toBe("advisory");
  });
});

describe("community outcome", () => {
  const counts = (overVotes: number, falseVotes: number, confirmations = 1) => ({
    confirmations,
    overVotes,
    falseVotes,
  });

  it("resolves unconfirmed after two over votes and verified after three", () => {
    expect(communityOutcome("unconfirmed", "standard", counts(1, 0))).toBeNull();
    expect(communityOutcome("unconfirmed", "standard", counts(2, 0))).toBe("resolved");
    expect(communityOutcome("verified", "high", counts(2, 0))).toBeNull();
    expect(communityOutcome("verified", "high", counts(3, 0))).toBe("resolved");
  });

  it("disputes after three false votes that outnumber confirmations", () => {
    expect(communityOutcome("unconfirmed", "standard", counts(0, 3))).toBe("disputed");
    expect(communityOutcome("unconfirmed", "standard", counts(0, 3, 4))).toBeNull();
    expect(communityOutcome("verified", "standard", counts(0, 9))).toBeNull();
  });

  it("never acts on critical incidents or on states the public cannot react to", () => {
    expect(communityOutcome("verified", "critical", counts(10, 10))).toBeNull();
    expect(communityOutcome("held", "standard", counts(10, 10))).toBeNull();
    expect(communityOutcome("resolved", "standard", counts(10, 10))).toBeNull();
  });
});

describe("broadcast tiles", () => {
  it("covers the centre tile and only tiles the circle reaches", () => {
    const small = tilesForCircle(6.5244, 3.3792, 500);
    expect(small).toEqual([tileFor(6.5244, 3.3792)]);
    const wide = tilesForCircle(6.5244, 3.3792, 20_000);
    expect(wide).toContain(tileFor(6.5244, 3.3792));
    expect(wide.length).toBeGreaterThan(9);
    expect(wide.length).toBeLessThan(30);
    expect(tilesForCircle(6.5244, 3.3792, 50_000).length).toBeLessThan(110);
  });
});
