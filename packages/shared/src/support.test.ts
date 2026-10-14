import { describe, expect, it } from "vitest";
import { SUPPORT_SERVICES, type SupportService, supportFor } from "./support.ts";

describe("support services", () => {
  it("never shows a service that has not been confirmed", () => {
    expect(SUPPORT_SERVICES.every((s) => !s.verified)).toBe(true);
    expect(supportFor("sexual_violence", "LA")).toEqual([]);
  });

  it("lists confirmed services for the category, local ones first", () => {
    const base = { kind: "counselling", phone: "0800", verified: true } as const;
    const services: SupportService[] = [
      { ...base, id: "national", name: "N", categories: ["domestic_violence"], states: "all" },
      { ...base, id: "lagos", name: "L", categories: ["domestic_violence"], states: ["LA"] },
      { ...base, id: "kano", name: "K", categories: ["domestic_violence"], states: ["KN"] },
      {
        ...base,
        id: "nophone",
        name: "P",
        categories: ["domestic_violence"],
        states: "all",
        phone: "",
      },
      { ...base, id: "other", name: "O", categories: ["missing_person"], states: "all" },
    ];
    expect(supportFor("domestic_violence", "LA", services).map((s) => s.id)).toEqual([
      "lagos",
      "national",
    ]);
    expect(supportFor("domestic_violence", null, services).map((s) => s.id)).toEqual(["national"]);
  });
});
