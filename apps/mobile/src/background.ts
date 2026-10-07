// Checks for alerts while the app is closed. Android runs this through WorkManager roughly
// every 15 minutes or later, depending on battery saving; it is a safety net, not a siren.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundTask from "expo-background-task";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import type * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { checkAlerts } from "./lib/alertCheck.ts";
import { checkBroadcast } from "./lib/broadcasts.ts";
import { showNotifications } from "./lib/notify.ts";
import { getInstallId, loadSettings } from "./lib/settings.ts";
import { createSource } from "./lib/source.ts";
import { LOCATION_TASK, recordLocations, sendPendingEnds } from "./safetyRuntime.ts";

export const ALERT_TASK = "warden-alert-check";
const INTERVAL_MINUTES = 15;

const extra = (Constants.expoConfig?.extra ?? {}) as {
  apiUrl?: string;
  broadcastPublicKey?: string;
};

/** One check using the saved settings; shared by the background task and the open app. */
export async function runStoredAlertCheck(options: { notify: boolean }) {
  const settings = await loadSettings(AsyncStorage, extra.apiUrl ?? "");
  const installId = await getInstallId(AsyncStorage, randomUUID);
  const source = createSource(settings, installId);
  const result = await checkAlerts({
    store: AsyncStorage,
    feedId: source.feedId,
    fetchAlerts: (tiles, after) => source.alerts(tiles, after),
    now: () => new Date(),
    checkBroadcast: (alert) =>
      alert.broadcast
        ? checkBroadcast(alert.broadcast, extra.broadcastPublicKey || null)
        : "invalid",
  });
  if (options.notify) await showNotifications(result.notifications);
  return result;
}

// Must be defined when the JavaScript bundle loads, before any screen renders.
TaskManager.defineTask(ALERT_TASK, async () => {
  try {
    await sendPendingEnds().catch(() => undefined);
    await runStoredAlertCheck({ notify: true });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Receives positions from the location service while a trip or SOS is running.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data) return;
    try {
      await recordLocations(data.locations);
    } catch {
      // Kept in the queue; the next update retries.
    }
  },
);

/**
 * Keeps the background check registered. It sends alerts (when switched on) and any trip or SOS
 * stop that could not be sent at the time. Returns false when the phone does not allow it.
 */
export async function ensureBackgroundChecks(): Promise<boolean> {
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  if (!(await TaskManager.isTaskRegisteredAsync(ALERT_TASK))) {
    await BackgroundTask.registerTaskAsync(ALERT_TASK, { minimumInterval: INTERVAL_MINUTES });
  }
  return true;
}
