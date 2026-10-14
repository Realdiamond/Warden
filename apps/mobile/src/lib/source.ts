// Where the app gets its data: the live API, or built-in demo data when no server is set up.

import {
  type AlertsResponse,
  type AreaOutlooksResponse,
  type BBox,
  type CommunityPost,
  type CommunityTip,
  DEMO_SAFE_STOPS,
  type PublicAlert,
  type PublicIncident,
  type PublicPresence,
  type ReactionKind,
  type ReactionResult,
  type ReportStatus,
  type ReportSubmission,
  type SafeStop,
  SESSION_MAX_MS,
  type SessionFlag,
  type SessionPoint,
  type SessionStart,
  TIME_WINDOW_MS,
  type TimeWindow,
  tierFor,
  tileFor,
} from "@warden/shared";
import { type FileSender, type SendResult, type SessionStartResult, WardenApi } from "./api.ts";
import { DEMO_INCIDENTS } from "./demoData.ts";
import { insideBBox } from "./geo.ts";
import type { MediaUpload, UploadOutcome } from "./media.ts";

export interface DataSource {
  kind: "live" | "demo";
  /** Identifies where alerts come from, so a saved feed position is never sent elsewhere. */
  feedId: string;
  incidents(bbox: BBox, window: TimeWindow): Promise<PublicIncident[]>;
  /** Responder deployments shown publicly, as areas. */
  presence(bbox: BBox): Promise<PublicPresence[]>;
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
  /** True once the server has it (or the session is already over). */
  flagSession(sessionId: string, controlToken: string, reason: SessionFlag): Promise<boolean>;
  safeStops(bbox: BBox): Promise<SafeStop[]>;
  communityFeed(bbox: BBox): Promise<CommunityPost[]>;
  /** Null when accepted; otherwise a message to show. */
  sendTip(tip: CommunityTip): Promise<string | null>;
  flagPost(postId: string): Promise<boolean>;
  /** M8: sends one queued voice note, photo, video or SOS clip. */
  uploadMedia(item: MediaUpload, sendFile: FileSender): Promise<UploadOutcome>;
  /** M8: the spoken version of a broadcast, or null when it has none. */
  broadcastAudio(broadcastId: string): Promise<Uint8Array | null>;
  /** M8: how often serious things were reported in areas on the map. */
  outlook(bbox: BBox): Promise<AreaOutlooksResponse>;
}

export function liveSource(api: WardenApi): DataSource {
  return {
    kind: "live",
    feedId: api.baseUrl,
    incidents: (bbox, window) => api.incidents(bbox, window),
    presence: (bbox) => api.presence(bbox),
    send: (body, key) => api.submitReport(body, key),
    status: (id, token) => api.status(id, token),
    alerts: (tiles, after) => api.alerts(tiles, after),
    react: (id, kind) => api.react(id, kind),
    startSession: (body) => api.startSession(body),
    sessionPoints: (id, token, points) => api.sessionPoints(id, token, points),
    extendSession: (id, token, minutes) => api.extendSession(id, token, minutes),
    endSession: (id, token, outcome, duress) => api.endSession(id, token, outcome, duress),
    flagSession: (id, token, reason) => api.flagSession(id, token, reason),
    safeStops: (bbox) => api.safeStops(bbox),
    communityFeed: (bbox) => api.communityFeed(bbox),
    uploadMedia: (item, sendFile) => api.uploadMedia(item, sendFile),
    broadcastAudio: (id) => api.broadcastAudio(id),
    outlook: (bbox) => api.outlook(bbox),
    sendTip: (tip) => api.sendTip(tip),
    flagPost: (id) => api.flagPost(id),
  };
}

/** Two sample deployments, drawn on the areas of two sample incidents. */
function demoPresence(now: number): PublicPresence[] {
  const until = new Date(now + 3 * 3_600_000).toISOString();
  return DEMO_INCIDENTS.slice(0, 2).map((item, index) => ({
    id: `demo-presence-${index}`,
    kind: index === 0 ? "patrol" : "ambulance",
    organisationKind: index === 0 ? "police" : "health",
    organisation: index === 0 ? "Demo Police Division" : "Demo Ambulance Service",
    label: index === 0 ? "Night patrol" : "Ambulance on standby",
    cell: item.cell,
    center: item.center,
    boundary: item.boundary,
    until,
  }));
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
      broadcast: null,
    }));
  return { alerts, cursor: DEMO_CURSOR };
}

/** Sample feed items around the sample incidents. */
export function demoPosts(now: number): CommunityPost[] {
  const at = (minutes: number) => new Date(now - minutes * 60_000).toISOString();
  const until = new Date(now + 24 * 3_600_000).toISOString();
  return [
    {
      id: "demo-post-1",
      kind: "notice",
      body: "Demo: Expect heavy traffic and crowds around Ikeja Under Bridge this evening.",
      source: "Warden team",
      areaLabel: "Ikeja",
      center: { lat: 6.6018, lng: 3.3515 },
      publishedAt: at(40),
      expiresAt: until,
    },
    {
      id: "demo-post-2",
      kind: "tip",
      body: "Demo: Street lights are out on the service lane near the bus stop. Walk in groups after dark.",
      source: null,
      areaLabel: null,
      center: { lat: 6.5, lng: 3.37 },
      publishedAt: at(95),
      expiresAt: until,
    },
    {
      id: "demo-post-3",
      kind: "tip",
      body: "Demo: Phone snatchers on okadas around the junction. Keep phones inside when walking.",
      source: null,
      areaLabel: null,
      center: { lat: 9.06, lng: 7.49 },
      publishedAt: at(180),
      expiresAt: until,
    },
  ];
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
          responder: null,
        };
      });
    },
    async presence(bbox) {
      return demoPresence(now()).filter((p) => insideBBox(p.center, bbox));
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
    async flagSession() {
      return true;
    },
    async safeStops(bbox) {
      return DEMO_SAFE_STOPS.filter((stop) => insideBBox(stop, bbox));
    },
    async communityFeed(bbox) {
      return demoPosts(now()).filter((post) => insideBBox(post.center, bbox));
    },
    async sendTip() {
      return null;
    },
    async flagPost() {
      return true;
    },
    // Demo files stay on the phone and are deleted.
    async uploadMedia() {
      return "sent";
    },
    async broadcastAudio() {
      return null;
    },
    async outlook(bbox) {
      return {
        outlooks: demoOutlooks().filter((o) => insideBBox(o.center, bbox)),
        generatedAt: new Date(now()).toISOString(),
      };
    },
  };
}

/** A hexagon a few kilometres across, like the server's areas. */
function hexagon(center: { lat: number; lng: number }): Array<[number, number]> {
  const ring: Array<[number, number]> = [];
  for (let i = 0; i <= 6; i++) {
    const angle = (Math.PI / 3) * (i % 6);
    ring.push([center.lng + 0.022 * Math.cos(angle), center.lat + 0.02 * Math.sin(angle)]);
  }
  return ring;
}

function demoOutlooks(): AreaOutlooksResponse["outlooks"] {
  const areas = [
    {
      cell: "demo-ikeja",
      center: { lat: 6.6, lng: 3.35 },
      level: "elevated" as const,
      trend: "rising" as const,
      incidents: 23,
      peak: { day: "Friday" as const, band: "evening" as const },
    },
    {
      cell: "demo-yaba",
      center: { lat: 6.51, lng: 3.38 },
      level: "moderate" as const,
      trend: "steady" as const,
      incidents: 9,
      peak: null,
    },
  ];
  return areas.map((area) => ({ ...area, boundary: hexagon(area.center) }));
}

export function createSource(
  settings: { apiUrl: string; demoMode: boolean; reporterCode?: string },
  installId: string,
): DataSource {
  if (settings.demoMode || !settings.apiUrl) return demoSource();
  return liveSource(new WardenApi(settings.apiUrl, installId, fetch, settings.reporterCode ?? ""));
}
