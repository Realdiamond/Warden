// Talks to the Warden API. Never sends the phone's own location: reports carry the incident's
// location and a distance band only.

import type {
  AlertsResponse,
  BBox,
  PublicIncident,
  ReactionKind,
  ReactionResult,
  ReportReceipt,
  ReportStatus,
  ReportSubmission,
  SessionPoint,
  SessionReceipt,
  SessionStart,
  TimeWindow,
} from "@warden/shared";

export type SessionStartResult =
  | { ok: true; receipt: SessionReceipt }
  | { ok: false; message: string };

export type SendResult =
  | { ok: true; receipt: ReportReceipt }
  | { ok: false; retry: boolean; message: string };

const TIMEOUT_MS = 15_000;

export class WardenApi {
  readonly baseUrl: string;
  readonly #installId: string;
  readonly #fetch: typeof fetch;

  constructor(baseUrl: string, installId: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.#installId = installId;
    this.#fetch = fetchImpl;
  }

  async #request(path: string, init: RequestInit = {}): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      return await this.#fetch(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async incidents(bbox: BBox, window: TimeWindow): Promise<PublicIncident[]> {
    const box = [bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat]
      .map((n) => n.toFixed(5))
      .join(",");
    const response = await this.#request(`/v1/map/incidents?bbox=${box}&window=${window}`);
    if (!response.ok) throw new Error(`Map request failed (${response.status})`);
    const body = (await response.json()) as { incidents: PublicIncident[] };
    return body.incidents;
  }

  async submitReport(body: ReportSubmission, idempotencyKey: string): Promise<SendResult> {
    let response: Response;
    try {
      response = await this.#request("/v1/reports", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-warden-install": this.#installId,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(body),
      });
    } catch {
      return {
        ok: false,
        retry: true,
        message: "No connection. Your report is saved and will be sent.",
      };
    }
    if (response.ok) return { ok: true, receipt: (await response.json()) as ReportReceipt };
    const problem = (await response.json().catch(() => null)) as { title?: string } | null;
    const retry = response.status >= 500 || response.status === 429;
    return {
      ok: false,
      retry,
      message: problem?.title ?? `The server refused the report (${response.status}).`,
    };
  }

  async status(reportId: string, statusToken: string): Promise<ReportStatus | null> {
    const response = await this.#request(`/v1/reports/${encodeURIComponent(reportId)}/status`, {
      headers: { "x-warden-install": this.#installId, "x-warden-status-token": statusToken },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`Status request failed (${response.status})`);
    return (await response.json()) as ReportStatus;
  }

  /** Alerts for coarse tiles only; the phone matches its saved places itself. */
  async alerts(tiles: string[], after: string | null): Promise<AlertsResponse> {
    const query = `tiles=${tiles.join(",")}${after ? `&after=${encodeURIComponent(after)}` : ""}`;
    const response = await this.#request(`/v1/alerts?${query}`);
    if (!response.ok) throw new Error(`Alerts request failed (${response.status})`);
    return (await response.json()) as AlertsResponse;
  }

  async react(incidentId: string, kind: ReactionKind): Promise<ReactionResult | null> {
    const response = await this.#request(
      `/v1/incidents/${encodeURIComponent(incidentId)}/reactions`,
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-warden-install": this.#installId },
        body: JSON.stringify({ kind }),
      },
    );
    if (response.status === 404 || response.status === 409) return null;
    if (!response.ok) throw new Error(`Reaction failed (${response.status})`);
    return (await response.json()) as ReactionResult;
  }

  async startSession(body: SessionStart): Promise<SessionStartResult> {
    try {
      const response = await this.#request("/v1/sessions", {
        method: "POST",
        headers: { "content-type": "application/json", "x-warden-install": this.#installId },
        body: JSON.stringify(body),
      });
      if (response.ok) return { ok: true, receipt: (await response.json()) as SessionReceipt };
      const problem = (await response.json().catch(() => null)) as { title?: string } | null;
      return { ok: false, message: problem?.title ?? `The server refused (${response.status}).` };
    } catch {
      return { ok: false, message: "No connection." };
    }
  }

  async #control(sessionId: string, controlToken: string, action: string, body: unknown) {
    return this.#request(`/v1/sessions/${encodeURIComponent(sessionId)}/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-warden-session-control": controlToken },
      body: JSON.stringify(body),
    });
  }

  async sessionPoints(
    sessionId: string,
    controlToken: string,
    points: SessionPoint[],
  ): Promise<{ ok: true } | { ok: false; ended: boolean }> {
    try {
      const response = await this.#control(sessionId, controlToken, "points", { points });
      if (response.ok) return { ok: true };
      return { ok: false, ended: response.status === 404 || response.status === 409 };
    } catch {
      return { ok: false, ended: false };
    }
  }

  async extendSession(
    sessionId: string,
    controlToken: string,
    minutes: number,
  ): Promise<string | null> {
    try {
      const response = await this.#control(sessionId, controlToken, "extend", { minutes });
      if (!response.ok) return null;
      return ((await response.json()) as { expectedArrivalAt: string }).expectedArrivalAt;
    } catch {
      return null;
    }
  }

  async endSession(
    sessionId: string,
    controlToken: string,
    outcome: "arrived" | "safe" | "cancelled",
    duress: boolean,
  ): Promise<boolean> {
    try {
      const response = await this.#control(sessionId, controlToken, "end", { outcome, duress });
      // 404 and 409 mean it is already over, which is what was asked for.
      return response.ok || response.status === 404 || response.status === 409;
    } catch {
      return false;
    }
  }
}
