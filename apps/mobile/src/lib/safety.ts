// The trip or SOS running on this phone. Locations are queued on the phone and sent in batches,
// so a weak signal delays them but does not lose them.

import { MAX_POINTS_PER_UPLOAD, type SessionKind, type SessionPoint } from "@warden/shared";
import type { KeyValueStore } from "./outbox.ts";

export interface ActiveSession {
  /** Null in demo mode, where nothing is sent. */
  sessionId: string | null;
  controlToken: string | null;
  kind: SessionKind;
  viewUrl: string | null;
  /** The server this session lives on. */
  feedId: string;
  startedAt: string;
  expectedArrivalAt: string | null;
  destinationLabel: string | null;
  pending: SessionPoint[];
  lastSentAt: string | null;
}

export type PointsResult = { ok: true } | { ok: false; ended: boolean };
export type PointsSender = (
  sessionId: string,
  controlToken: string,
  points: SessionPoint[],
) => Promise<PointsResult>;

const ACTIVE_KEY = "warden.safety.active.v1";
const PENDING_ENDS_KEY = "warden.safety.pendingEnds.v1";
/** About four hours of points at one every 30 seconds. */
const MAX_PENDING = 500;

export async function loadActive(store: KeyValueStore): Promise<ActiveSession | null> {
  const raw = await store.getItem(ACTIVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as ActiveSession;
  } catch {
    return null;
  }
}

export async function saveActive(
  store: KeyValueStore,
  session: ActiveSession | null,
): Promise<void> {
  if (session) await store.setItem(ACTIVE_KEY, JSON.stringify(session));
  else await store.removeItem(ACTIVE_KEY);
}

export function queuePoints(session: ActiveSession, points: SessionPoint[]): ActiveSession {
  const pending = [...session.pending, ...points].slice(-MAX_PENDING);
  return { ...session, pending };
}

/**
 * Sends queued points oldest first. Stops at the first failure and keeps what is left.
 * Returns ended=true when the server says the session is over.
 */
export async function flushPoints(
  session: ActiveSession,
  send: PointsSender,
  now: Date,
): Promise<{ session: ActiveSession; ended: boolean }> {
  if (!session.sessionId || !session.controlToken) {
    return { session: { ...session, pending: [] }, ended: false };
  }
  let current = session;
  while (current.pending.length > 0) {
    const batch = current.pending.slice(0, MAX_POINTS_PER_UPLOAD);
    const result = await send(session.sessionId as string, session.controlToken as string, batch);
    if (!result.ok) return { session: current, ended: result.ended };
    current = {
      ...current,
      pending: current.pending.slice(batch.length),
      lastSentAt: now.toISOString(),
    };
  }
  return { session: current, ended: false };
}

export function minutesLeft(session: ActiveSession, now: Date): number | null {
  if (!session.expectedArrivalAt) return null;
  return Math.round((new Date(session.expectedArrivalAt).getTime() - now.getTime()) / 60_000);
}

/** The message a person sends their contacts from their own phone. */
export function shareText(kind: SessionKind, personName: string, viewUrl: string | null): string {
  const link = viewUrl ? ` ${viewUrl}` : "";
  return kind === "sos"
    ? `SOS: I need help. My live location:${link} If you cannot reach me, call 112.`
    : `I'm sharing my trip with you on Warden. Follow my live location:${link}`.concat(
        personName ? ` - ${personName}` : "",
      );
}

/** A stop the server has not heard about yet (no signal); retried until it gets through. */
export interface PendingEnd {
  sessionId: string;
  controlToken: string;
  outcome: "arrived" | "safe" | "cancelled";
  duress: boolean;
}

export type EndSender = (end: PendingEnd) => Promise<boolean>;

export async function loadPendingEnds(store: KeyValueStore): Promise<PendingEnd[]> {
  const raw = await store.getItem(PENDING_ENDS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingEnd[]) : [];
  } catch {
    return [];
  }
}

export async function addPendingEnd(store: KeyValueStore, end: PendingEnd): Promise<void> {
  const list = (await loadPendingEnds(store)).filter((e) => e.sessionId !== end.sessionId);
  await store.setItem(PENDING_ENDS_KEY, JSON.stringify([...list, end].slice(-10)));
}

/** Sends stops that are still waiting; keeps the ones that fail. */
export async function retryPendingEnds(store: KeyValueStore, send: EndSender): Promise<number> {
  const list = await loadPendingEnds(store);
  if (list.length === 0) return 0;
  const left: PendingEnd[] = [];
  for (const end of list) {
    const ok = await send(end).catch(() => false);
    if (!ok) left.push(end);
  }
  await store.setItem(PENDING_ENDS_KEY, JSON.stringify(left));
  return list.length - left.length;
}
