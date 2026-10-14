// The trip or SOS running on this phone. Locations are queued on the phone and sent in batches,
// so a weak signal delays them but does not lose them.

import {
  answerCheckIn,
  CHECK_IN_WINDOW_MS,
  distanceMeters,
  MAX_POINTS_PER_UPLOAD,
  newRouteWatch,
  type RouteWatch,
  type SessionFlag,
  type SessionKind,
  type SessionPoint,
  updateRouteWatch,
} from "@warden/shared";
import { type Language, strings } from "./i18n.ts";
import type { KeyValueStore } from "./outbox.ts";

/** "Are you OK?" after the person left their route (see packages/shared/src/route.ts). */
export interface CheckIn {
  askedAt: string;
  /** Contacts are told at this time unless the person answers. */
  dueAt: string;
  /** The server has been told. */
  flagged: boolean;
}

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
  /** Trips with a destination only; missing in sessions saved by older versions. */
  route?: RouteWatch | null;
  checkIn?: CheckIn | null;
}

/** Starts the off-route check for a trip that has a destination. */
export function routeWatchFor(
  kind: SessionKind,
  destination: { lat: number; lng: number } | undefined,
): RouteWatch | null {
  return kind === "trip" && destination ? newRouteWatch(destination) : null;
}

/**
 * Feeds new positions into the off-route check. Returns ask=true once, when the phone should
 * ask "Are you OK?"; the answer is due CHECK_IN_WINDOW_MS later.
 */
export function watchRoute(
  session: ActiveSession,
  points: SessionPoint[],
  now: Date,
): { session: ActiveSession; ask: boolean } {
  if (!session.route || session.kind !== "trip") return { session, ask: false };
  let route = session.route;
  let ask = false;
  let arrived = false;
  for (const point of points) {
    const result = updateRouteWatch(route, point);
    route = result.watch;
    if (result.status === "ask") {
      ask = true;
      arrived = false;
    } else if (result.status === "near") {
      ask = false;
      arrived = true;
    }
  }
  const previous = session.checkIn ?? null;
  // Reaching the destination settles an unanswered question; contacts who were already told
  // still need the person to answer.
  const checkIn: CheckIn | null = ask
    ? {
        askedAt: now.toISOString(),
        dueAt: new Date(now.getTime() + CHECK_IN_WINDOW_MS).toISOString(),
        flagged: false,
      }
    : arrived && !previous?.flagged
      ? null
      : previous;
  return { session: { ...session, route, checkIn }, ask };
}

/** True when the person did not answer in time and the server has not been told yet. */
export function checkInOverdue(session: ActiveSession, now: Date): boolean {
  const checkIn = session.checkIn;
  return !!checkIn && !checkIn.flagged && new Date(checkIn.dueAt).getTime() <= now.getTime();
}

/** The person answered "I'm OK": the detour is accepted from where they are now. */
export function answerRouteCheck(
  session: ActiveSession,
  here: { lat: number; lng: number } | null,
): ActiveSession {
  if (!session.route) return { ...session, checkIn: null };
  const distance = here ? distanceMeters(here, session.route.destination) : null;
  return { ...session, route: answerCheckIn(session.route, distance), checkIn: null };
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
export function shareText(
  kind: SessionKind,
  personName: string,
  viewUrl: string | null,
  language?: Language,
): string {
  const t = strings(language);
  const link = viewUrl ? ` ${viewUrl}` : "";
  return kind === "sos" ? t.sosShare(link) : t.tripShare(link, personName);
}

/** A flag the server has not heard about yet (no signal); retried like a stop. */
export interface PendingFlag {
  sessionId: string;
  controlToken: string;
  reason: SessionFlag;
}

const PENDING_FLAGS_KEY = "warden.safety.pendingFlags.v1";

export async function loadPendingFlags(store: KeyValueStore): Promise<PendingFlag[]> {
  const raw = await store.getItem(PENDING_FLAGS_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as PendingFlag[]) : [];
  } catch {
    return [];
  }
}

/** Sends a flag now, or keeps it to send later. Returns true when the server has it. */
export async function sendOrQueueFlag(
  store: KeyValueStore,
  flag: PendingFlag,
  send: (flag: PendingFlag) => Promise<boolean>,
): Promise<boolean> {
  const sent = await send(flag).catch(() => false);
  if (!sent) {
    const pending = await loadPendingFlags(store);
    await store.setItem(PENDING_FLAGS_KEY, JSON.stringify([...pending, flag].slice(-20)));
  }
  return sent;
}

/** Retries flags in order; stops at the first failure so they reach the server in order. */
export async function retryPendingFlags(
  store: KeyValueStore,
  send: (flag: PendingFlag) => Promise<boolean>,
): Promise<number> {
  const pending = await loadPendingFlags(store);
  let sent = 0;
  for (const flag of pending) {
    if (!(await send(flag).catch(() => false))) break;
    sent += 1;
  }
  if (sent > 0) await store.setItem(PENDING_FLAGS_KEY, JSON.stringify(pending.slice(sent)));
  return sent;
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
