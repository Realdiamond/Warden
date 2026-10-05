// Talks to the Warden API. Never sends the phone's own location: reports carry the incident's
// location and a distance band only.

import type {
  BBox,
  PublicIncident,
  ReportReceipt,
  ReportStatus,
  ReportSubmission,
  TimeWindow,
} from "@warden/shared";

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
}
