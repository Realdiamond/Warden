// One alert check: fetch new alerts for the saved places' tiles, update the inbox and return
// the notifications to show. Used by the foreground poll and by the background task.

import type { AlertsResponse } from "@warden/shared";
import {
  type AlertPlace,
  type AlertPrefs,
  type AlertState,
  loadAlertPrefs,
  loadAlertState,
  type PlannedNotification,
  processAlerts,
  saveAlertState,
  tilesForPlaces,
} from "./alerts.ts";
import type { KeyValueStore } from "./outbox.ts";
import { loadLastArea, loadPlaces } from "./places.ts";

export interface AlertCheckDeps {
  store: KeyValueStore;
  /** Identifies the server (or demo data) the cursor belongs to. */
  feedId: string;
  fetchAlerts(tiles: string[], after: string | null): Promise<AlertsResponse>;
  now(): Date;
}

export interface AlertCheckResult {
  state: AlertState;
  prefs: AlertPrefs;
  notifications: PlannedNotification[];
}

const MAX_PAGES = 5;
const FEED_PAGE = 200;

export async function alertPlaces(store: KeyValueStore, prefs: AlertPrefs): Promise<AlertPlace[]> {
  const places: AlertPlace[] = await loadPlaces(store);
  if (prefs.aroundMe) {
    const area = await loadLastArea(store);
    if (area) places.push({ name: "where you were last", lat: area.lat, lng: area.lng });
  }
  return places;
}

let running: Promise<AlertCheckResult> | null = null;

/** Single-flight: a check that starts while another runs gets the same result. */
export function checkAlerts(deps: AlertCheckDeps): Promise<AlertCheckResult> {
  if (!running) {
    running = runCheck(deps).finally(() => {
      running = null;
    });
  }
  return running;
}

async function runCheck(deps: AlertCheckDeps): Promise<AlertCheckResult> {
  const prefs = await loadAlertPrefs(deps.store);
  let state = await loadAlertState(deps.store);
  if (state.feedId !== deps.feedId) state = { ...state, feedId: deps.feedId, cursor: null };

  const places = await alertPlaces(deps.store, prefs);
  if (!prefs.enabled || places.length === 0) return { state, prefs, notifications: [] };
  const tiles = tilesForPlaces(places);

  const fetched: AlertsResponse["alerts"] = [];
  let cursor = state.cursor;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const feed = await deps.fetchAlerts(tiles, cursor);
    fetched.push(...feed.alerts);
    cursor = feed.cursor;
    if (feed.alerts.length < FEED_PAGE) break;
  }
  const result = processAlerts(state, fetched, places, prefs, deps.now());
  state = { ...result.state, cursor };
  // Saved before notifying: a crash may lose a notification but never repeats one.
  await saveAlertState(deps.store, state);
  return { state, prefs, notifications: result.notifications };
}
