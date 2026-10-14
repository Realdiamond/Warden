import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ModeratorPost } from "@warden/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommunityPage } from "./pages/CommunityPage.tsx";
import { parseRoute, routeHref } from "./router.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("CommunityPage", () => {
  it("shows waiting tips with warnings and publishes one", async () => {
    const items: ModeratorPost[] = [
      {
        id: "t1",
        kind: "tip",
        state: "pending",
        body: "Call 0803 123 4567 about the thief",
        center: { lat: 6.5, lng: 3.4 },
        createdAt: new Date().toISOString(),
        flags: 0,
        warnings: ["Contains a phone number"],
      },
    ];
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/actions")
        ? new Response(JSON.stringify({ state: "published" }), { status: 200 })
        : new Response(JSON.stringify({ items }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<CommunityPage />);
    expect(await screen.findByText("Call 0803 123 4567 about the thief")).toBeTruthy();
    expect(screen.getByText("Contains a phone number")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Publish" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/t1/actions"))).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/t1/actions"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({ action: "publish" });
  });

  it("has its own route", () => {
    expect(parseRoute(routeHref({ page: "community" }))).toEqual({ page: "community" });
  });
});
