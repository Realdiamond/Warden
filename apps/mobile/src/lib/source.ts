// Where the app gets its data: the live API, or built-in demo data when no server is set up.

import {
  type BBox,
  type PublicIncident,
  type ReportStatus,
  type ReportSubmission,
  TIME_WINDOW_MS,
  type TimeWindow,
} from "@warden/shared";
import { type SendResult, WardenApi } from "./api.ts";
import { DEMO_INCIDENTS } from "./demoData.ts";
import { insideBBox } from "./geo.ts";

export interface DataSource {
  kind: "live" | "demo";
  incidents(bbox: BBox, window: TimeWindow): Promise<PublicIncident[]>;
  send(body: ReportSubmission, idempotencyKey: string): Promise<SendResult>;
  status(reportId: string, statusToken: string): Promise<ReportStatus | null>;
}

export function liveSource(api: WardenApi): DataSource {
  return {
    kind: "live",
    incidents: (bbox, window) => api.incidents(bbox, window),
    send: (body, key) => api.submitReport(body, key),
    status: (id, token) => api.status(id, token),
  };
}

export function demoSource(now: () => number = Date.now): DataSource {
  return {
    kind: "demo",
    async incidents(bbox, window) {
      const cutoff = TIME_WINDOW_MS[window] / 60_000;
      return DEMO_INCIDENTS.filter(
        (item) => item.minutesAgo <= cutoff && insideBBox(item.center, bbox),
      ).map((item) => {
        const at = new Date(now() - item.minutesAgo * 60_000).toISOString();
        return {
          id: item.id,
          categoryId: item.categoryId,
          severity: item.severity,
          label: item.label,
          reportCount: item.reportCount,
          firstReportedAt: at,
          lastReportAt: at,
          active: item.active,
          cell: item.cell,
          center: item.center,
          boundary: item.boundary,
        };
      });
    },
    async send(_body, key) {
      return {
        ok: true,
        receipt: {
          reportId: `demo-${key}`,
          statusToken: "demo",
          receivedAt: new Date(now()).toISOString(),
        },
      };
    },
    async status(reportId) {
      return {
        reportId,
        status: "in_review",
        reportCount: 1,
        updatedAt: new Date(now()).toISOString(),
      };
    },
  };
}

export function createSource(
  settings: { apiUrl: string; demoMode: boolean },
  installId: string,
): DataSource {
  if (settings.demoMode || !settings.apiUrl) return demoSource();
  return liveSource(new WardenApi(settings.apiUrl, installId));
}
