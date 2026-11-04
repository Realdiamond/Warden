import { describe, expect, it } from "vitest";
import {
  isOnboarded,
  markOnboarded,
  NUMBERED_STEPS,
  nextStep,
  ONBOARDING_STEPS,
  pressKey,
  previousStep,
} from "./onboarding.ts";
import type { KeyValueStore } from "./outbox.ts";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: async (key) => data.get(key) ?? null,
    setItem: async (key, value) => {
      data.set(key, value);
    },
    removeItem: async (key) => {
      data.delete(key);
    },
  };
}

describe("first-run setup", () => {
  it("is remembered once finished", async () => {
    const store = memoryStore();
    expect(await isOnboarded(store)).toBe(false);
    await markOnboarded(store);
    expect(await isOnboarded(store)).toBe(true);
  });

  it("goes through the steps in order and stops at both ends", () => {
    expect(ONBOARDING_STEPS[0]).toBe("welcome");
    expect(nextStep("welcome")).toBe("privacy");
    expect(nextStep("home")).toBe("ready");
    expect(nextStep("ready")).toBe("ready");
    expect(previousStep("privacy")).toBe("welcome");
    expect(previousStep("welcome")).toBe("welcome");
    expect(NUMBERED_STEPS).toHaveLength(5);
  });
});

describe("PIN keypad", () => {
  it("adds digits up to four and removes the last one", () => {
    let pin = "";
    for (const key of ["1", "2", "3", "4", "5"]) pin = pressKey(pin, key);
    expect(pin).toBe("1234");
    expect(pressKey(pin, "back")).toBe("123");
    expect(pressKey("", "back")).toBe("");
  });

  it("ignores anything that is not a digit", () => {
    expect(pressKey("12", "x")).toBe("12");
    expect(pressKey("12", "12")).toBe("12");
  });
});
