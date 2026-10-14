import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { NewsLead, SessionView } from "@warden/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MediaList } from "./components/MediaList.tsx";
import { LivePage } from "./live/LivePage.tsx";
import { NewsPage } from "./pages/NewsPage.tsx";
import { parseRoute, routeHref } from "./router.ts";

vi.mock("./live/LiveMap.tsx", () => ({ default: () => <div>map</div> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.location.hash = "";
});

describe("NewsPage", () => {
  const lead: NewsLead = {
    id: "n1",
    source: "Example News",
    url: "https://news.example.ng/story",
    title: "Gunmen attack travellers on Abuja-Kaduna road",
    summary: "Several travellers were kidnapped on Tuesday.",
    publishedAt: new Date().toISOString(),
    categoryId: "kidnapping",
    place: "Kaduna",
    createdAt: new Date().toISOString(),
  };

  it("adds a story to the map with the kind the moderator chose", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/actions")
        ? new Response(JSON.stringify({ incidentId: "i1" }), { status: 200 })
        : new Response(JSON.stringify({ items: [lead] }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<NewsPage />);
    const link = await screen.findByText(lead.title);
    expect(link.getAttribute("href")).toBe(lead.url);
    expect(link.getAttribute("rel")).toContain("noopener");

    fireEvent.click(screen.getByRole("button", { name: "Add to map" }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/n1/actions"))).toBe(true),
    );
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/n1/actions"));
    expect(JSON.parse(String(call?.[1]?.body))).toEqual({
      action: "add",
      categoryId: "kidnapping",
    });
    expect(await screen.findByText(/unconfirmed for the whole area/)).toBeTruthy();
  });

  it("will not add a story until a public kind is chosen", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ items: [{ ...lead, categoryId: null }] }), {
            status: 200,
          }),
      ),
    );
    render(<NewsPage />);
    await screen.findByText(lead.title);
    expect((screen.getByRole("button", { name: "Add to map" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    const options = Array.from(screen.getByRole("combobox").querySelectorAll("option")).map(
      (o) => o.value,
    );
    expect(options).not.toContain("sexual_violence");
    expect(options).not.toContain("missing_person");
  });

  it("has its own route", () => {
    expect(parseRoute(routeHref({ page: "news" }))).toEqual({ page: "news" });
  });
});

describe("MediaList", () => {
  it("opens a file only when asked, with the console header", async () => {
    const fetchMock = vi.fn(
      async () => new Response("x", { status: 200, headers: { "content-type": "image/jpeg" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // The test browser has no object URLs.
    URL.createObjectURL = () => "blob:x";
    URL.revokeObjectURL = () => undefined;
    render(
      <MediaList
        media={[
          { id: "m1", kind: "photo", contentType: "image/jpeg", bytes: 120_000, createdAt: "" },
        ]}
        urlFor={(id) => `/v1/admin/media/${id}`}
      />,
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Open photo (120 KB)" }));
    expect(await screen.findByAltText("Sent with the report")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/admin/media/m1");
    expect((init.headers as Record<string, string>)["x-warden-console"]).toBe("1");
  });
});

describe("SOS sound on the live page", () => {
  it("lists clips for the contact to play", async () => {
    const ID = "3f2b8c1e-8d4a-4e43-9a4c-1b2c3d4e5f60";
    const TOKEN = "abcdefghijklmnopqrstuvwxyz0123456789ABCDEFG";
    window.location.hash = `#${ID}.${TOKEN}`;
    const view: SessionView = {
      kind: "sos",
      state: "active",
      alarm: true,
      duress: false,
      offRouteAt: null,
      personName: "Ada",
      note: null,
      destination: null,
      expectedArrivalAt: null,
      startedAt: "2026-10-05T12:00:00Z",
      endedAt: null,
      outcome: null,
      lastPoint: null,
      track: [],
    };
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith("/audio")
        ? new Response(
            JSON.stringify({
              clips: [{ id: "c1", recordedAt: "2026-10-05T12:01:00Z", bytes: 40_000 }],
            }),
          )
        : new Response(JSON.stringify(view)),
    );
    vi.stubGlobal("fetch", fetchMock);
    render(<LivePage />);
    expect(await screen.findByText("Sound from their phone")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Listen" })).toBeTruthy();
    const audioCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/audio")) as
      | unknown[]
      | undefined;
    const init = audioCall?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["x-warden-session-view"]).toBe(TOKEN);
  });
});
