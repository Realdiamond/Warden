import { describe, expect, it } from "vitest";
import { WardenApi } from "./api.ts";
import { feedArea } from "./geo.ts";
import { demoSource } from "./source.ts";

describe("community feed", () => {
  it("shows sample posts for the area in demo mode and never sends a tip", async () => {
    const source = demoSource(() => Date.parse("2026-10-01T12:00:00Z"));
    const lagos = await source.communityFeed(feedArea({ lat: 6.55, lng: 3.36 }));
    expect(lagos.map((p) => p.kind)).toEqual(["notice", "tip"]);
    expect(lagos.every((p) => p.body.startsWith("Demo"))).toBe(true);
    expect(
      await source.sendTip({ body: "Lights out on the lane", location: { lat: 6.5, lng: 3.4 } }),
    ).toBeNull();
  });

  it("sends tips and flags with the install id only, and explains refusals", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    let status = 202;
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(status === 204 ? null : JSON.stringify({ title: "Refused" }), { status });
    }) as unknown as typeof fetch;
    const api = new WardenApi("https://x", "install-1", fakeFetch);
    const tip = { body: "Lights out on the lane", location: { lat: 6.5, lng: 3.4 } };
    expect(await api.sendTip(tip)).toBeNull();
    expect(calls[0]?.url).toBe("https://x/v1/community/tips");
    expect(JSON.parse(String(calls[0]?.init.body))).toEqual(tip);
    status = 429;
    expect(await api.sendTip(tip)).toContain("Try again later");
    status = 400;
    expect(await api.sendTip(tip)).toBe("Refused");

    status = 204;
    expect(await api.flagPost("p1")).toBe(true);
    expect(calls.at(-1)?.url).toBe("https://x/v1/community/posts/p1/flag");
    const headers = calls.at(-1)?.init.headers as Record<string, string> | undefined;
    expect(headers?.["x-warden-install"]).toBe("install-1");
  });
});
