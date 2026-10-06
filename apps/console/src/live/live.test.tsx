import { cleanup, render, screen } from "@testing-library/react";
import type { SessionView } from "@warden/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { headline, LivePage } from "./LivePage.tsx";

// The map needs WebGL, which the test browser lacks; the page must work without it.
vi.mock("./LiveMap.tsx", () => ({ default: () => <div>map</div> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

const ID = "3f2b8c1e-8d4a-4e43-9a4c-1b2c3d4e5f60";
const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";

const view: SessionView = {
  kind: "trip",
  state: "active",
  alarm: false,
  duress: false,
  personName: "Ada",
  note: "Blue Toyota",
  destination: { lat: 6.45, lng: 3.4, label: "Lekki" },
  expectedArrivalAt: "2026-10-05T12:30:00Z",
  startedAt: "2026-10-05T12:00:00Z",
  endedAt: null,
  outcome: null,
  lastPoint: { lat: 6.5, lng: 3.38, accuracyM: 12, at: "2026-10-05T12:05:00Z", battery: 41 },
  track: [[3.38, 6.5]],
};

describe("live page", () => {
  it("words each situation plainly", () => {
    expect(headline(view)).toEqual({ tone: "calm", text: "Ada is sharing their trip with you." });
    expect(headline({ ...view, state: "overdue", alarm: true }).tone).toBe("alarm");
    expect(headline({ ...view, kind: "sos", alarm: true }).text).toContain("SOS");
    expect(headline({ ...view, duress: true, alarm: true }).text).toContain("may be in danger");
    expect(headline({ ...view, state: "ended", outcome: "arrived", endedAt: null }).text).toBe(
      "Ada arrived safely.",
    );
  });

  it("reads the token from the fragment and sends it as a header", async () => {
    window.location.hash = `#${ID}.${TOKEN}`;
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ...view, kind: "sos", alarm: true })),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LivePage />);
    expect(await screen.findByText("Ada has asked for help (SOS).")).toBeTruthy();
    expect(screen.getByText("Call 112").getAttribute("href")).toBe("tel:112");
    expect(screen.getByText("41%")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`/v1/sessions/${ID}/view`);
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>)["x-warden-session-view"]).toBe(TOKEN);
  });

  it("explains broken and expired links", async () => {
    render(<LivePage />);
    expect(screen.getByText(/This link is incomplete/)).toBeTruthy();
    cleanup();
    window.location.hash = `#${ID}.${TOKEN}`;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 404 })),
    );
    render(<LivePage />);
    expect(await screen.findByText(/expired or is not valid/)).toBeTruthy();
  });
});
