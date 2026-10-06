// Where the app gets its data: the live API, or built-in demo data when no server is set up.

import {
  type AlertsResponse,
  type BBox,
  type PublicAlert,
  type PublicIncident,
  type ReactionKind,
  type ReactionResult,
  type ReportStatus,
  type ReportSubmission,
  SESSION_MAX_MS,
  type SessionPoint,
  type SessionStart,
  TIME_WINDOW_MS,
  type TimeWindow,
  tierFor,
  tileFor,
} from "@warden/shared";
import { type SendResult, type SessionStartResult, WardenApi } from "./api.ts";
import { DEMO_INCIDENTS } from "./demoData.ts";
import { insideBBox } from "./geo.ts";

export interface DataSource {
  kind: "live" | "demo";
  /** Identifies where alerts come from, so a saved feed position is never sent elsewhere. */
  feedId: string;
  incidents(bbox: BBox, window: TimeWindow): Promise<PublicIncident[]>;
  send(body: ReportSubmission, idempotencyKey: string): Promise<SendResult>;
  status(reportId: string, statusToken: string): Promise<ReportStatus | null>;
  alerts(tiles: string[], after: string | null): Promise<AlertsResponse>;
  /** Null when the incident is closed or gone. */
  react(incidentId: string, kind: ReactionKind): Promise<ReactionResult | null>;
  startSession(body: SessionStart): Promise<SessionStartResult>;
  sessionPoints(
    sessionId: string,
    controlToken: string,
    points: SessionPoint[],
  ): Promise<{ ok: true } | { ok: false; ended: boolean }>;
  extendSession(sessionId: string, controlToken: string, minutes: number): Promise<string | null>;
  endSession(
    sessionId: string,
    controlToken: string,
    outcome: "arrived" | "safe" | "cancelled",
    duress: boolean,
  ): Promise<boolean>;
}

export function liveSource(api: WardenApi): DataSource {
  return {
    kind: "live",
    feedId: api.baseUrl,
    incidents: (bbox, window) => api.incidents(bbox, window),
    send: (body, key) => api.submitReport(body, key),
    status: (id, token) => api.status(id, token),
    alerts: (tiles, after) => api.alerts(tiles, after),
    react: (id, kind) => api.react(id, kind),
    startSession: (body) => api.startSession(body),
    sessionPoints: (id, token, points) => api.sessionPoints(id, token, points),
    extendSession: (id, token, minutes) => api.extendSession(id, token, minutes),
    endSession: (id, token, outcome, duress) => api.endSession(id, token, outcome, duress),
  };
}

const DEMO_CURSOR = "demo";
const DEMO_ALERT_WINDOW_MIN = 6 * 60;

/** Demo alerts: the active sample incidents, sent once, labelled as demo. */
export function demoAlerts(tiles: string[], after: string | null, now: number): AlertsResponse {
  if (after === DEMO_CURSOR) return { alerts: [], cursor: DEMO_CURSOR };
  const wanted = new Set(tiles);
  const alerts: PublicAlert[] = DEMO_INCIDENTS.filter(
    (item) =>
      item.active &&
      item.minutesAgo <= DEMO_ALERT_WINDOW_MIN &&
      wanted.has(tileFor(item.center.lat, item.center.lng)),
  )
    .sort((a, b) => b.minutesAgo - a.minutesAgo)
    .map((item) => ({
      id: `demo_${item.id}`,
      incidentId: item.id,
      kind: "new",
      tier: tierFor(item.severity),
      categoryId: item.categoryId,
      label: item.label,
      center: item.center,
      message: null,
      source: "demo",
      visibleAt: new Date(now - item.minutesAgo * 60_000).toISOString(),
    }));
  return { alerts, cursor: DEMO_CURSOR };
}

export function demoSource(now: () => number = Date.now): DataSource {
  return {
    kind: "demo",
    feedId: "demo",
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
    async alerts(tiles, after) {
      return demoAlerts(tiles, after, now());
    },
    async react(incidentId) {
      const item = DEMO_INCIDENTS.find((incident) => incident.id === incidentId);
      return item ? { accepted: true, label: item.label } : null;
    },
    // Demo sessions stay on the phone: no link, no messages.
    async startSession() {
      return {
        ok: true,
        receipt: {
          sessionId: "demo",
          viewToken: "demo",
          controlToken: "demo",
          viewUrl: null,
          expiresAt: new Date(now() + SESSION_MAX_MS).toISOString(),
        },
      };
    },
    async sessionPoints() {
      return { ok: true };
    },
    async extendSession(_id, _token, minutes) {
      return new Date(now() + minutes * 60_000).toISOString();
    },
    async endSession() {
      return true;
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
