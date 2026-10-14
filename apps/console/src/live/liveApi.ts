import type { SessionClip, SessionView } from "@warden/shared";

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

/** Sound recorded during an SOS, newest first (M8). Empty when there is none or it failed. */
export async function fetchClips(sessionId: string, viewToken: string): Promise<SessionClip[]> {
  try {
    const response = await fetch(`/v1/sessions/${encodeURIComponent(sessionId)}/audio`, {
      headers: { "x-warden-session-view": viewToken },
      cache: "no-store",
    });
    if (!response.ok) return [];
    const body = (await response.json()) as { clips?: SessionClip[] };
    return Array.isArray(body.clips) ? body.clips : [];
  } catch {
    return [];
  }
}

/** One clip as a playable address, or null when it could not be fetched. */
export async function fetchClipUrl(
  sessionId: string,
  viewToken: string,
  clipId: string,
): Promise<string | null> {
  try {
    const response = await fetch(
      `/v1/sessions/${encodeURIComponent(sessionId)}/audio/${encodeURIComponent(clipId)}`,
      { headers: { "x-warden-session-view": viewToken }, cache: "no-store" },
    );
    if (!response.ok) return null;
    return URL.createObjectURL(await response.blob());
  } catch {
    return null;
  }
}
