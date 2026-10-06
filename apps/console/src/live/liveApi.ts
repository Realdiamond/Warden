import type { SessionView } from "@warden/shared";

export type LiveResult = { kind: "ok"; view: SessionView } | { kind: "gone" } | { kind: "error" };

/** The token travels in a header, never in the address, so it stays out of server logs. */
export async function fetchSession(sessionId: string, viewToken: string): Promise<LiveResult> {
  try {
    const response = await fetch(`/v1/sessions/${encodeURIComponent(sessionId)}/view`, {
      headers: { "x-warden-session-view": viewToken },
      cache: "no-store",
    });
    if (response.status === 404) return { kind: "gone" };
    if (!response.ok) return { kind: "error" };
    return { kind: "ok", view: (await response.json()) as SessionView };
  } catch {
    return { kind: "error" };
  }
}
