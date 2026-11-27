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
  direction: string;
  durationSec: number;
}

export interface MessagePayload {
  app: string;
  sender?: string;
  text: string;
  source?: string; // "notification" | "chat"
}

export interface AppUsagePayload {
  packageName: string;
  appLabel?: string;
  foregroundMs: number;
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

let token: string | null = localStorage.getItem("monitor_token");

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem("monitor_token", t);
  else localStorage.removeItem("monitor_token");
}

export function getToken(): string | null {
  return token;
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
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
