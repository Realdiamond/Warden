import { cleanup, render, screen } from "@testing-library/react";
import type { FleetOverview } from "@warden/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FleetPage } from "./fleet/FleetPage.tsx";

vi.mock("./responder/PointPicker.tsx", () => ({ default: () => <div>map</div> }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FleetPage", () => {
  it("shows each place with what the public map shows around it", async () => {
    const overview: FleetOverview = {
      generatedAt: new Date().toISOString(),
      zones: [
        {
          zone: { id: "z1", name: "Apapa depot", center: { lat: 6.45, lng: 3.36 }, radiusM: 2000 },
          incidents: [
            {
              id: "i1",
              categoryId: "armed_robbery",
              severity: "high",
              label: "Corroborated",
              reportCount: 2,
              firstReportedAt: new Date().toISOString(),
              lastReportAt: new Date().toISOString(),
              active: true,
              cell: "89589c984c7ffff",
              center: { lat: 6.45, lng: 3.36 },
              boundary: [],
              responder: null,
            },
          ],
          bySeverity: { critical: 0, high: 1, standard: 0 },
          outlook: null,
        },
        {
          zone: { id: "z2", name: "Ikeja yard", center: { lat: 6.6, lng: 3.35 }, radiusM: 1000 },
          incidents: [],
          bySeverity: { critical: 0, high: 0, standard: 0 },
          outlook: null,
        },
      ],
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(overview), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<FleetPage />);
    expect(await screen.findByText("Apapa depot")).toBeTruthy();
    expect(screen.getByText(/1 incident nearby in the last 24 hours/)).toBeTruthy();
    expect(screen.getByText("Nothing reported nearby in the last 24 hours.")).toBeTruthy();
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toBe("/v1/admin/fleet/overview");
  });
});
