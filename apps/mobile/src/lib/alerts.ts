// Turns the server's alert feed into alerts for this person: matched to their saved places on
// the phone, filtered by their preferences, with quiet hours and flood control. Plain
// TypeScript so it can be tested without a phone.

import {
  ALERT_RADIUS_M,
  type AlertTier,
  distanceMeters,
  getCategory,
  MAX_ALERT_TILES,
  type PublicAlert,
  publicLabelOf,
  tilesAround,
} from "@warden/shared";
import type { KeyValueStore } from "./outbox.ts";

export interface AlertPlace {
  name: string;
  lat: number;
  lng: number;
}

export interface AlertPrefs {
  enabled: boolean;
  /** Critical alerts cannot be switched off while alerts are on. */
  tiers: { warning: boolean; advisory: boolean };
  quietHours: { enabled: boolean; startHour: number; endHour: number };
  speak: boolean;
  /** Also alert around where the phone last was while the app was open. */
  aroundMe: boolean;
}

export const DEFAULT_ALERT_PREFS: AlertPrefs = {
  enabled: true,
  tiers: { warning: true, advisory: false },
  quietHours: { enabled: false, startHour: 22, endHour: 6 },
  speak: false,
  aroundMe: false,
};

export interface InboxEntry {
  alert: PublicAlert;
  placeName: string;
  distanceM: number;
  read: boolean;
  receivedAt: string;
}

export interface AlertState {
  /** Which server the cursor belongs to; a different server starts afresh. */
  feedId: string | null;
  cursor: string | null;
  inbox: InboxEntry[];
  /** Incidents this person has been told about, so follow-ups ("it's over") reach them. */
  toldAbout: string[];
}

export const EMPTY_ALERT_STATE: AlertState = {
  feedId: null,
  cursor: null,
  inbox: [],
  toldAbout: [],
};

export type NotificationChannel = AlertTier | "updates" | "quiet";

export interface PlannedNotification {
  alertId: string;
  incidentId: string | null;
  channel: NotificationChannel;
  title: string;
  body: string;
  /** Text to read aloud when spoken alerts are on and it is not quiet time. */
  speech: string | null;
}

const MAX_INBOX = 100;
const MAX_TOLD_ABOUT = 300;
/** Alerts older than this go to the inbox without a notification. */
export const NOTIFY_MAX_AGE_MS = 3 * 3_600_000;
/** More than this many in one check become one summary notification. */
export const MAX_NOTIFICATIONS_PER_CHECK = 3;

const PREFS_KEY = "warden.alertPrefs.v1";
const STATE_KEY = "warden.alertState.v1";

export async function loadAlertPrefs(store: KeyValueStore): Promise<AlertPrefs> {
  const raw = await store.getItem(PREFS_KEY);
  if (!raw) return DEFAULT_ALERT_PREFS;
  try {
    const p = JSON.parse(raw) as Partial<AlertPrefs>;
    return {
      enabled: p.enabled ?? DEFAULT_ALERT_PREFS.enabled,
      tiers: { ...DEFAULT_ALERT_PREFS.tiers, ...p.tiers },
      quietHours: { ...DEFAULT_ALERT_PREFS.quietHours, ...p.quietHours },
      speak: p.speak ?? DEFAULT_ALERT_PREFS.speak,
      aroundMe: p.aroundMe ?? DEFAULT_ALERT_PREFS.aroundMe,
    };
  } catch {
    return DEFAULT_ALERT_PREFS;
  }
}

export async function saveAlertPrefs(store: KeyValueStore, prefs: AlertPrefs): Promise<void> {
  await store.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export async function loadAlertState(store: KeyValueStore): Promise<AlertState> {
  const raw = await store.getItem(STATE_KEY);
  if (!raw) return EMPTY_ALERT_STATE;
  try {
    const s = JSON.parse(raw) as Partial<AlertState>;
    return {
      feedId: typeof s.feedId === "string" ? s.feedId : null,
      cursor: typeof s.cursor === "string" ? s.cursor : null,
      inbox: Array.isArray(s.inbox) ? s.inbox : [],
      toldAbout: Array.isArray(s.toldAbout) ? s.toldAbout : [],
    };
  } catch {
    return EMPTY_ALERT_STATE;
  }
}

export async function saveAlertState(store: KeyValueStore, state: AlertState): Promise<void> {
  await store.setItem(STATE_KEY, JSON.stringify(state));
}

/** The coarse tiles to ask the server about. Reveals only roughly which parts of Nigeria. */
export function tilesForPlaces(places: AlertPlace[]): string[] {
  const tiles = new Set<string>();
  for (const place of places) {
    for (const tile of tilesAround(place.lat, place.lng)) tiles.add(tile);
  }
  return [...tiles].slice(0, MAX_ALERT_TILES);
}

export function matchPlace(
  alert: PublicAlert,
  places: AlertPlace[],
): { place: AlertPlace; distanceM: number } | null {
  const radius = ALERT_RADIUS_M[alert.tier];
  let best: { place: AlertPlace; distanceM: number } | null = null;
  for (const place of places) {
    const distanceM = distanceMeters(place, alert.center);
    if (distanceM <= radius && (!best || distanceM < best.distanceM)) best = { place, distanceM };
  }
  return best;
}

/** Quiet hours in the phone's local time; the window may cross midnight. */
export function isQuietTime(prefs: AlertPrefs, at: Date): boolean {
  const { enabled, startHour, endHour } = prefs.quietHours;
  if (!enabled || startHour === endHour) return false;
  const hour = at.getHours();
  return startHour < endHour
    ? hour >= startHour && hour < endHour
    : hour >= startHour || hour < endHour;
}

function tierEnabled(prefs: AlertPrefs, tier: AlertTier): boolean {
  return tier === "critical" || prefs.tiers[tier];
}

export function describeDistance(meters: number): string {
  if (meters < 1_000) return `about ${Math.max(100, Math.round(meters / 100) * 100)} m`;
  return `about ${(meters / 1_000).toFixed(1)} km`;
}

function minutesAgo(iso: string, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - new Date(iso).getTime()) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function alertTitle(alert: PublicAlert): string {
  if (alert.kind === "broadcast") return `Message from ${alert.source ?? "a responder"}`;
  const category = alert.categoryId ? getCategory(alert.categoryId) : undefined;
  const name = category ? publicLabelOf(category) : "Incident";
  switch (alert.kind) {
    case "resolved":
      return `Over: ${name}`;
    case "correction":
      return `Update: ${name}`;
    case "upgraded":
      return `Verified: ${name}`;
    default:
      return alert.tier === "critical"
        ? `Danger: ${name}`
        : alert.tier === "warning"
          ? `Warning: ${name}`
          : name;
  }
}

function alertBody(alert: PublicAlert, entry: InboxEntry, now: Date): string {
  const demo = alert.source === "demo" ? "Demo, not real. " : "";
  const where = `Near ${entry.placeName} (${describeDistance(entry.distanceM)})`;
  if (alert.kind === "broadcast") return `${demo}${alert.message ?? ""} · ${where}`;
  const what =
    alert.kind === "resolved"
      ? "Reported as over."
      : alert.kind === "correction"
        ? "Some people say this is wrong. Being checked."
        : alert.label === "Verified"
          ? "Confirmed."
          : alert.label === "Corroborated"
            ? "Reported by more than one person."
            : "One report, not yet confirmed.";
  return `${demo}${where}, ${minutesAgo(alert.visibleAt, now)}. ${what}`;
}

const FOLLOW_UPS = new Set<PublicAlert["kind"]>(["resolved", "correction"]);

/**
 * Adds new alerts to the inbox and decides which notifications to show. Alerts already in the
 * inbox are ignored, so checking twice never notifies twice.
 */
export function processAlerts(
  state: AlertState,
  alerts: PublicAlert[],
  places: AlertPlace[],
  prefs: AlertPrefs,
  now: Date,
): { state: AlertState; notifications: PlannedNotification[] } {
  const seen = new Set(state.inbox.map((entry) => entry.alert.id));
  const toldAbout = new Set(state.toldAbout);
  const added: InboxEntry[] = [];
  const planned: PlannedNotification[] = [];
  const quiet = isQuietTime(prefs, now);

  for (const alert of alerts) {
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);
    const followUp = FOLLOW_UPS.has(alert.kind);
    // Only people who heard about an incident need to hear that it is over.
    if (followUp && (!alert.incidentId || !toldAbout.has(alert.incidentId))) continue;
    const match = matchPlace(alert, places);
    if (!match) continue;

    const entry: InboxEntry = {
      alert,
      placeName: match.place.name,
      distanceM: match.distanceM,
      read: false,
      receivedAt: now.toISOString(),
    };
    added.push(entry);

    const fresh = now.getTime() - new Date(alert.visibleAt).getTime() <= NOTIFY_MAX_AGE_MS;
    const wanted = prefs.enabled && (followUp || tierEnabled(prefs, alert.tier));
    if (!fresh || !wanted) continue;
    if (alert.incidentId) toldAbout.add(alert.incidentId);

    const channel: NotificationChannel = followUp
      ? "updates"
      : quiet && alert.tier !== "critical"
        ? "quiet"
        : alert.tier;
    const title = alertTitle(alert);
    const body = alertBody(alert, entry, now);
    planned.push({
      alertId: alert.id,
      incidentId: alert.incidentId,
      channel,
      title,
      body,
      speech: prefs.speak && channel !== "quiet" ? `${title}. ${body}` : null,
    });
  }

  const nextState: AlertState = {
    feedId: state.feedId,
    cursor: state.cursor,
    inbox: [...added.reverse(), ...state.inbox].slice(0, MAX_INBOX),
    toldAbout: [...toldAbout].slice(-MAX_TOLD_ABOUT),
  };
  return { state: nextState, notifications: limitNotifications(planned) };
}

const CHANNEL_RANK: Record<NotificationChannel, number> = {
  critical: 0,
  warning: 1,
  advisory: 2,
  updates: 3,
  quiet: 4,
};

/** Shows the most serious few and folds the rest into one summary, so a busy hour is not a flood. */
export function limitNotifications(planned: PlannedNotification[]): PlannedNotification[] {
  if (planned.length <= MAX_NOTIFICATIONS_PER_CHECK) return planned;
  const sorted = [...planned].sort((a, b) => CHANNEL_RANK[a.channel] - CHANNEL_RANK[b.channel]);
  const shown = sorted.slice(0, MAX_NOTIFICATIONS_PER_CHECK - 1);
  const rest = sorted.slice(MAX_NOTIFICATIONS_PER_CHECK - 1);
  const loudest = rest.reduce((a, b) =>
    CHANNEL_RANK[a.channel] <= CHANNEL_RANK[b.channel] ? a : b,
  );
  shown.push({
    alertId: `summary_${rest.map((n) => n.alertId).join("+")}`,
    incidentId: null,
    channel: loudest.channel,
    title: `${rest.length} more alerts near your places`,
    body: "Open Warden to see them.",
    speech: null,
  });
  return shown;
}

export function unreadCount(state: AlertState): number {
  return state.inbox.filter((entry) => !entry.read).length;
}

export function markAllRead(state: AlertState): AlertState {
  return { ...state, inbox: state.inbox.map((entry) => ({ ...entry, read: true })) };
}
