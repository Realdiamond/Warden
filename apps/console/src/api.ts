import type {
  BroadcastInput,
  BroadcastSummary,
  CommunityNotice,
  DeploymentInput,
  FleetOverview,
  FleetZone,
  FleetZoneInput,
  IncidentDetail,
  IncidentState,
  IncidentUpdateInput,
  ModerationAction,
  ModeratorPost,
  NewsDecision,
  NewsLead,
  PostState,
  QueueItem,
  ResponderDeployment,
  ResponderInboxItem,
  ResponderIncidentDetail,
  RouteCheckResult,
  SignedBroadcast,
  SosBoardItem,
  StaffUser,
} from "@warden/shared";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

type Listener = () => void;
let onUnauthorized: Listener = () => undefined;

/** Called whenever the API says the session is gone, so the app can show the sign-in page. */
export function setUnauthorizedListener(listener: Listener): void {
  onUnauthorized = listener;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "x-warden-console": "1" };
  if (init.body) headers["content-type"] = "application/json";
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
  });
  if (response.status === 204) return undefined as T;
  const body = (await response.json().catch(() => null)) as { title?: string } | null;
  if (!response.ok) {
    if (response.status === 401 && !path.endsWith("/login")) onUnauthorized();
    throw new ApiError(response.status, body?.title ?? `Request failed (${response.status})`);
  }
  return body as T;
}

export const api = {
  me: () => request<StaffUser>("/v1/admin/me"),
  login: (email: string, password: string) =>
    request<StaffUser>("/v1/admin/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/v1/admin/logout", { method: "POST" }),
  queue: (state: IncidentState) =>
    request<{ items: QueueItem[] }>(`/v1/admin/queue?state=${encodeURIComponent(state)}`),
  incident: (id: string) =>
    request<IncidentDetail>(`/v1/admin/incidents/${encodeURIComponent(id)}`),
  act: (id: string, action: ModerationAction, reason?: string) =>
    request<{ id: string; previousState: IncidentState; state: IncidentState }>(
      `/v1/admin/incidents/${encodeURIComponent(id)}/actions`,
      { method: "POST", body: JSON.stringify(reason ? { action, reason } : { action }) },
    ),

  community: {
    queue: () => request<{ items: ModeratorPost[] }>("/v1/admin/community/queue"),
    decide: (id: string, action: "publish" | "reject" | "remove", reason?: string) =>
      request<{ state: PostState }>(`/v1/admin/community/posts/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify(reason ? { action, reason } : { action }),
      }),
    notice: (input: CommunityNotice) =>
      request<{ id: string }>("/v1/admin/community/notices", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },

  fleet: {
    overview: () => request<FleetOverview>("/v1/admin/fleet/overview"),
    addZone: (input: FleetZoneInput) =>
      request<FleetZone>("/v1/admin/fleet/zones", { method: "POST", body: JSON.stringify(input) }),
    removeZone: (id: string) =>
      request<void>(`/v1/admin/fleet/zones/${encodeURIComponent(id)}`, { method: "DELETE" }),
    routeCheck: (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
      request<RouteCheckResult>("/v1/admin/fleet/route-check", {
        method: "POST",
        body: JSON.stringify({ from, to }),
      }),
  },

  news: {
    queue: () => request<{ items: NewsLead[] }>("/v1/admin/news"),
    decide: (id: string, decision: NewsDecision) =>
      request<{ incidentId: string | null }>(`/v1/admin/news/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify(decision),
      }),
  },

  responder: {
    incidents: () => request<{ items: ResponderInboxItem[] }>("/v1/admin/responder/incidents"),
    incident: (id: string) =>
      request<ResponderIncidentDetail>(`/v1/admin/responder/incidents/${encodeURIComponent(id)}`),
    update: (id: string, input: IncidentUpdateInput) =>
      request<{ state: IncidentState }>(
        `/v1/admin/responder/incidents/${encodeURIComponent(id)}/updates`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    deployments: () => request<{ items: ResponderDeployment[] }>("/v1/admin/responder/deployments"),
    deploy: (input: DeploymentInput) =>
      request<{ id: string }>("/v1/admin/responder/deployments", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    endDeployment: (id: string) =>
      request<void>(`/v1/admin/responder/deployments/${encodeURIComponent(id)}/end`, {
        method: "POST",
        body: "{}",
      }),
    broadcasts: () => request<{ items: BroadcastSummary[] }>("/v1/admin/responder/broadcasts"),
    broadcast: (input: BroadcastInput) =>
      request<SignedBroadcast>("/v1/admin/responder/broadcasts", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    withdraw: (id: string) =>
      request<void>(`/v1/admin/responder/broadcasts/${encodeURIComponent(id)}/withdraw`, {
        method: "POST",
        body: "{}",
      }),
    sos: () => request<{ items: SosBoardItem[] }>("/v1/admin/responder/sos"),
  },
};
