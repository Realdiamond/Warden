const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export interface DeviceSummary {
  id: string;
  name: string | null;
  platform: string | null;
  pairedAt: string | null;
  consentAcceptedAt: string | null;
  lastSeenAt: string | null;
  blockedApps?: string[];
}

export interface LocationPayload {
  lat: number;
  lon: number;
  accuracyM?: number;
  speedMps?: number;
  battery?: number;
}

export interface CallPayload {
  number?: string;
  name?: string; // cached contact name from the phone, if the number is in contacts
  direction: string;
  durationSec: number;
}

export interface MessagePayload {
  app: string;
  sender?: string;
  text: string;
  source?: string; // "notification" | "chat"
  direction?: string; // "in" (received) | "out" (sent) — on-screen captures only
  conversation?: string; // chat title (contact/group), for grouping on-screen captures
}

export interface AppUsagePayload {
  packageName: string;
  appLabel?: string;
  foregroundMs: number;
}

export interface StatusPayload {
  permissions?: {
    location?: boolean;
    usage?: boolean;
    notifications?: boolean;
    accessibility?: boolean;
    deviceAdmin?: boolean;
    // Whether the capture services are actually running (Samsung can pause them while the
    // permission still shows granted), and whether the OS lets the app run in the background.
    accessibilityRunning?: boolean;
    notificationsRunning?: boolean;
    batteryUnrestricted?: boolean;
  };
  appVersion?: string;
}

export interface EventEnvelope<P = unknown> {
  id: string;
  deviceId: string;
  kind: string;
  capturedAt: string;
  receivedAt: string;
  payload: P;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

let token: string | null = localStorage.getItem("andsv_token");

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem("andsv_token", t);
  else localStorage.removeItem("andsv_token");
}

export function getToken(): string | null {
  return token;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {};
  // Only declare a JSON body when one is actually sent — a strict server rejects an empty body
  // carrying a JSON content-type (e.g. the bodyless pair-code / delete requests).
  if (init.body != null) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(BASE + path, { ...init, headers });
  const body: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const code =
      body && typeof body === "object" && "error" in body ? String((body as { error: unknown }).error) : "request_failed";
    throw new ApiError(res.status, code);
  }
  return body as T;
}

export const api = {
  signup: (email: string, password: string) =>
    req<{ accountId: string; token: string }>("/v1/accounts", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    req<{ accountId: string; token: string }>("/v1/sessions", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  listDevices: () => req<{ devices: DeviceSummary[] }>("/v1/devices"),
  createDevice: (name: string) =>
    req<{ deviceId: string; pairCode: string; pairCodeExpiresInMs: number }>("/v1/devices", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  getDevice: (id: string) => req<{ device: DeviceSummary }>(`/v1/devices/${id}`),
  relinkDevice: (id: string) =>
    req<{ pairCode: string; pairCodeExpiresInMs: number }>(`/v1/devices/${id}/pair-code`, {
      method: "POST",
    }),
  deleteDevice: (id: string) => req<{ deleted: boolean }>(`/v1/devices/${id}`, { method: "DELETE" }),
  setRules: (id: string, blockedApps: string[]) =>
    req<{ blockedApps: string[] }>(`/v1/devices/${id}/rules`, {
      method: "PUT",
      body: JSON.stringify({ blockedApps }),
    }),
  sendCommand: (id: string, type: "lock" | "unlock") =>
    req<{ id: string; type: string }>(`/v1/devices/${id}/commands`, {
      method: "POST",
      body: JSON.stringify({ type }),
    }),
  getEvents: (id: string, kind?: string, limit = 100) =>
    req<{ events: EventEnvelope[] }>(
      `/v1/devices/${id}/events?${new URLSearchParams({ ...(kind ? { kind } : {}), limit: String(limit) })}`,
    ),
};
