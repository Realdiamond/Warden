import { describe, expect, it } from "vitest";
import { CATEGORIES, requireCategory } from "./categories.ts";
import {
  applyAction,
  decidePublication,
  isPubliclyVisible,
  PUBLISH_DELAY_MAX_MS,
  PUBLISH_DELAY_MIN_MS,
  publicLabel,
  publicResolution,
  randomPublishDelay,
  stateAfterMerge,
} from "./rules.ts";

const theft = requireCategory("theft");
const robbery = requireCategory("armed_robbery");
const kidnapping = requireCategory("kidnapping");
const sexualViolence = requireCategory("sexual_violence");

describe("decidePublication", () => {
  it("publishes standard reports at once as unconfirmed", () => {
    const d = decidePublication({ category: theft, independentReports: 1, reporterTrust: "low" });
    expect(d).toMatchObject({ state: "unconfirmed", publishDelayMs: 0 });
  });

  it("holds a single high-severity report for a moderator", () => {
    const d = decidePublication({
      category: robbery,
      independentReports: 1,
      reporterTrust: "normal",
    });
    expect(d.state).toBe("held");
  });

  it("publishes corroborated high-severity reports after a random delay", () => {
    const d = decidePublication(
      { category: robbery, independentReports: 2, reporterTrust: "low" },
      () => 0.5,
    );
    expect(d.state).toBe("unconfirmed");
    expect(d.publishDelayMs).toBe(6 * 60_000);
  });

  it("lets a high-trust reporter publish a high-severity report alone", () => {
    const d = decidePublication({
      category: robbery,
      independentReports: 1,
      reporterTrust: "high",
    });
    expect(d.state).toBe("unconfirmed");
  });

  it("never publishes a critical report from a single source, whatever the trust", () => {
    const d = decidePublication({
      category: kidnapping,
      independentReports: 1,
      reporterTrust: "high",
    });
    expect(d.state).toBe("held");
  });

  it("publishes a critical report once two independent sources agree", () => {
    const d = decidePublication({
      category: kidnapping,
      independentReports: 2,
      reporterTrust: "low",
    });
    expect(d.state).toBe("unconfirmed");
    expect(d.publishDelayMs).toBeGreaterThanOrEqual(PUBLISH_DELAY_MIN_MS);
  });

  it("never publishes private categories, however many reports arrive", () => {
    const d = decidePublication({
      category: sexualViolence,
      independentReports: 10,
      reporterTrust: "high",
    });
    expect(d.state).toBe("held");
  });
});

describe("randomPublishDelay", () => {
  it("stays within 2 to 10 minutes even for bad random input", () => {
    expect(randomPublishDelay(() => 0)).toBe(PUBLISH_DELAY_MIN_MS);
    expect(randomPublishDelay(() => 1)).toBe(PUBLISH_DELAY_MAX_MS);
    expect(randomPublishDelay(() => -5)).toBe(PUBLISH_DELAY_MIN_MS);
    expect(randomPublishDelay(() => 7)).toBe(PUBLISH_DELAY_MAX_MS);
  });
});

describe("stateAfterMerge", () => {
  const publish = { state: "unconfirmed" as const, publishDelayMs: 0, reason: "" };
  const hold = { state: "held" as const, publishDelayMs: 0, reason: "" };

  it("releases a held incident when corroboration arrives", () => {
    expect(stateAfterMerge("held", publish)).toBe("unconfirmed");
  });

  it("never overrides a moderator decision", () => {
    expect(stateAfterMerge("verified", hold)).toBe("verified");
    expect(stateAfterMerge("disputed", publish)).toBe("disputed");
  });
});

describe("applyAction", () => {
  it.each([
    ["held", "verify", "verified"],
    ["unconfirmed", "verify", "verified"],
    ["verified", "hold", "held"],
    ["unconfirmed", "remove", "removed"],
    ["verified", "resolve", "resolved"],
    ["verified", "dispute", "disputed"],
    ["removed", "reopen", "held"],
  ] as const)("%s + %s -> %s", (from, action, to) => {
    expect(applyAction(from, action, theft)).toEqual({ ok: true, state: to });
  });

  it.each([
    ["merged", "verify"],
    ["removed", "verify"],
    ["held", "dispute"],
    ["unconfirmed", "reopen"],
  ] as const)("rejects %s + %s", (from, action) => {
    expect(applyAction(from, action, theft).ok).toBe(false);
  });

  it("refuses to verify a private category", () => {
    expect(applyAction("held", "verify", sexualViolence).ok).toBe(false);
    expect(applyAction("held", "resolve", sexualViolence).ok).toBe(true);
  });
});

describe("visibility and labels", () => {
  it("hides private categories in every state", () => {
    expect(isPubliclyVisible("verified", sexualViolence)).toBe(false);
  });

  it("hides held, removed and merged incidents", () => {
    for (const state of ["held", "removed", "merged"] as const) {
      expect(isPubliclyVisible(state, theft)).toBe(false);
    }
  });

  it("labels corroborated reports", () => {
    expect(publicLabel("unconfirmed", 1)).toBe("Unconfirmed");
    expect(publicLabel("unconfirmed", 3)).toBe("Corroborated");
    expect(publicLabel("held", 3)).toBeNull();
  });

  it("blurs critical incidents to the wider area", () => {
    expect(publicResolution("critical")).toBe(8);
    expect(publicResolution("high")).toBe(9);
  });
});

describe("taxonomy", () => {
  it("has unique ids", () => {
    const ids = CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("keeps sexual and domestic violence and missing persons private", () => {
    for (const id of ["sexual_violence", "domestic_violence", "missing_person"]) {
      expect(requireCategory(id).handling).toBe("private");
    }
  });
});
