import { cleanup, render, screen } from "@testing-library/react";
import type { QueueItem } from "@warden/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewDue, timeAgo } from "./format.ts";
import { QueuePage } from "./pages/QueuePage.tsx";
import { parseRoute, routeHref } from "./router.ts";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("format", () => {
  const now = Date.parse("2026-10-05T12:00:00Z");

  it("describes ages in plain words", () => {
    expect(timeAgo("2026-10-05T11:59:30Z", now)).toBe("just now");
    expect(timeAgo("2026-10-05T11:45:00Z", now)).toBe("15 min ago");
    expect(timeAgo("2026-10-05T09:00:00Z", now)).toBe("3 h ago");
  });

  it("describes review deadlines", () => {
    expect(reviewDue(4 * 60_000)).toBe("due in 4 min");
    expect(reviewDue(-12 * 60_000)).toBe("overdue by 12 min");
  });
});

describe("router", () => {
  it("round-trips routes and falls back to the held queue", () => {
    expect(parseRoute(routeHref({ page: "incident", id: "abc" }))).toEqual({
      page: "incident",
      id: "abc",
    });
    expect(parseRoute("#/queue/verified")).toEqual({ page: "queue", state: "verified" });
    expect(parseRoute("#/queue/bogus")).toEqual({ page: "queue", state: "held" });
    expect(parseRoute("")).toEqual({ page: "queue", state: "held" });
  });

  it("knows the responder pages", () => {
    expect(parseRoute(routeHref({ page: "r-incident", id: "x1" }))).toEqual({
      page: "r-incident",
      id: "x1",
    });
    for (const page of ["r-incidents", "r-deployments", "r-broadcasts", "r-sos"] as const) {
      expect(parseRoute(routeHref({ page }))).toEqual({ page });
    }
  });
});

describe("QueuePage", () => {
  it("lists held incidents, flags overdue reviews and marks private categories", async () => {
    const items: QueueItem[] = [
      {
        id: "1",
        categoryId: "kidnapping",
        severity: "critical",
        state: "held",
        reportCount: 2,
        independentReports: 1,
        firstReportedAt: new Date(Date.now() - 20 * 60_000).toISOString(),
        lastReportAt: new Date().toISOString(),
        publishAfter: null,
        cell: "88589c9b3bfffff",
        reviewDueInMs: -15 * 60_000,
      },
      {
        id: "2",
        categoryId: "domestic_violence",
        severity: "high",
        state: "held",
        reportCount: 1,
        independentReports: 1,
        firstReportedAt: new Date().toISOString(),
        lastReportAt: new Date().toISOString(),
        publishAfter: null,
        cell: "89589c9b3a7ffff",
        reviewDueInMs: 9 * 60_000,
      },
    ];
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ items }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    render(<QueuePage state="held" />);

    expect(await screen.findByText("Kidnapping")).toBeTruthy();
    expect(screen.getByText("overdue by 15 min")).toBeTruthy();
    expect(screen.getByText("Private")).toBeTruthy();
    expect(screen.getByText("(1 phones)")).toBeTruthy();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/v1/admin/queue?state=held");
    expect((init.headers as Record<string, string>)["x-warden-console"]).toBe("1");
  });
});
