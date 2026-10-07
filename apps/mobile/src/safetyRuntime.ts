// Starts, updates and stops trips and SOS. Shared by the screens and by the location task that
// keeps running (with a visible notification) while the app is in the background.

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { SessionKind, SessionPoint, SessionStart } from "@warden/shared";
import * as Battery from "expo-battery";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import * as Location from "expo-location";
import { loadProfile } from "./lib/contacts.ts";
import {
  type ActiveSession,
  addPendingEnd,
  flushPoints,
  loadActive,
  queuePoints,
  retryPendingEnds,
  saveActive,
} from "./lib/safety.ts";
import { getInstallId, loadSettings } from "./lib/settings.ts";
import { createSource, type DataSource } from "./lib/source.ts";

export const LOCATION_TASK = "warden-safety-location";

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };

export async function storedSource(): Promise<DataSource> {
  const settings = await loadSettings(AsyncStorage, extra.apiUrl ?? "");
  const installId = await getInstallId(AsyncStorage, randomUUID);
  return createSource(settings, installId);
}

async function batteryPercent(): Promise<number | undefined> {
  try {
    const level = await Battery.getBatteryLevelAsync();
    return level >= 0 ? Math.round(level * 100) : undefined;
  } catch {
    return undefined;
  }
}

export function toPoint(location: Location.LocationObject, battery?: number): SessionPoint {
  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracyM: location.coords.accuracy ?? undefined,
    at: new Date(location.timestamp).toISOString(),
    battery,
  };
}

/** Adds points to the queue and sends what it can. Stops sharing if the server says it is over. */
export async function recordPoints(points: SessionPoint[]): Promise<ActiveSession | null> {
  const active = await loadActive(AsyncStorage);
  if (!active) {
    await stopSharingLocation();
    return null;
  }
  const source = await storedSource();
  const queued = queuePoints(active, points);
  await saveActive(AsyncStorage, queued);
  const { session, ended } = await flushPoints(
    queued,
    (id, token, batch) => source.sessionPoints(id, token, batch),
    new Date(),
  );
  if (ended) {
    await saveActive(AsyncStorage, null);
    await stopSharingLocation();
    return null;
  }
  await saveActive(AsyncStorage, session);
  return session;
}

export async function recordLocations(locations: Location.LocationObject[]): Promise<void> {
  if (locations.length === 0) return;
  const battery = await batteryPercent();
  await recordPoints(locations.map((location) => toPoint(location, battery)));
}

/** Shares location with a visible notification; needs only "while using the app" permission. */
export async function startSharingLocation(kind: SessionKind): Promise<boolean> {
  const permission = await Location.requestForegroundPermissionsAsync();
  if (permission.status !== "granted") return false;
  try {
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: kind === "sos" ? 15_000 : 30_000,
      distanceInterval: kind === "sos" ? 10 : 40,
      pausesUpdatesAutomatically: false,
      foregroundService: {
        notificationTitle: kind === "sos" ? "Warden SOS is on" : "Warden is sharing your trip",
        notificationBody: "Your trusted contacts can see your location until you stop.",
        notificationColor: "#0F5C4D",
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopSharingLocation(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Already stopped.
  }
}

export type StartOutcome =
  | { ok: true; session: ActiveSession; sharing: boolean; demo: boolean }
  | { ok: false; message: string };

export async function startSafetySession(
  kind: SessionKind,
  trip: {
    expectedArrivalAt?: string;
    destination?: { lat: number; lng: number; label?: string };
    note?: string;
    shareWithResponders?: boolean;
  } = {},
): Promise<StartOutcome> {
  const existing = await loadActive(AsyncStorage);
  if (existing)
    return { ok: true, session: existing, sharing: true, demo: existing.feedId === "demo" };

  const profile = await loadProfile(AsyncStorage);
  const source = await storedSource();
  const body: SessionStart = {
    kind,
    personName: profile.personName.trim() || "A Warden user",
    contacts: profile.contacts.map((c) => ({ name: c.name, phone: c.phone })),
    shareWithResponders:
      kind === "sos" && (trip.shareWithResponders ?? profile.shareSosWithResponders),
    ...(trip.expectedArrivalAt ? { expectedArrivalAt: trip.expectedArrivalAt } : {}),
    ...(trip.destination ? { destination: trip.destination } : {}),
    ...(trip.note ? { note: trip.note } : {}),
  };
  const result = await source.startSession(body);
  if (!result.ok) return { ok: false, message: result.message };

  const session: ActiveSession = {
    sessionId: result.receipt.sessionId,
    controlToken: result.receipt.controlToken,
    kind,
    viewUrl: result.receipt.viewUrl,
    feedId: source.feedId,
    startedAt: new Date().toISOString(),
    expectedArrivalAt: trip.expectedArrivalAt ?? null,
    destinationLabel: trip.destination?.label ?? null,
    pending: [],
    lastSentAt: null,
  };
  await saveActive(AsyncStorage, session);
  const sharing = await startSharingLocation(kind);
  // Send a first position straight away so contacts see something at once.
  void Location.getLastKnownPositionAsync()
    .then(async (last) => (last ? recordLocations([last]) : undefined))
    .catch(() => undefined);
  return { ok: true, session, sharing, demo: source.kind === "demo" };
}

export async function extendActive(minutes: number): Promise<ActiveSession | null> {
  const active = await loadActive(AsyncStorage);
  if (!active?.sessionId || !active.controlToken) return active;
  const source = await storedSource();
  const next = await source.extendSession(active.sessionId, active.controlToken, minutes);
  if (!next) return null;
  const updated = { ...active, expectedArrivalAt: next };
  await saveActive(AsyncStorage, updated);
  return updated;
}

/**
 * Ends the session on this phone. With duress the server is told the person is in danger, but
 * the phone behaves exactly as for a normal stop. Without a signal the stop is saved and sent
 * later, so the screen never waits and an alarm is never lost. Returns whether it was sent now.
 */
export async function finishActive(
  outcome: "arrived" | "safe" | "cancelled",
  duress: boolean,
): Promise<boolean> {
  const active = await loadActive(AsyncStorage);
  if (!active) return true;
  await saveActive(AsyncStorage, null);
  await stopSharingLocation();
  if (!active.sessionId || !active.controlToken) return true;

  const source = await storedSource();
  // Last positions first, so contacts see where the person was.
  await flushPoints(
    active,
    (id, token, batch) => source.sessionPoints(id, token, batch),
    new Date(),
  ).catch(() => undefined);
  const told = await source
    .endSession(active.sessionId, active.controlToken, outcome, duress)
    .catch(() => false);
  if (!told) {
    await addPendingEnd(AsyncStorage, {
      sessionId: active.sessionId,
      controlToken: active.controlToken,
      outcome,
      duress,
    });
  }
  return told;
}

/** Called on app start and by the background check. */
export async function sendPendingEnds(): Promise<void> {
  const source = await storedSource();
  await retryPendingEnds(AsyncStorage, (end) =>
    source.endSession(end.sessionId, end.controlToken, end.outcome, end.duress),
  );
}
