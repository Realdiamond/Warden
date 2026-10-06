// Checks for alerts while the app is closed. Android runs this through WorkManager roughly
// every 15 minutes or later, depending on battery saving; it is a safety net, not a siren.

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as BackgroundTask from "expo-background-task";
import Constants from "expo-constants";
import { randomUUID } from "expo-crypto";
import * as TaskManager from "expo-task-manager";
import { checkAlerts } from "./lib/alertCheck.ts";
import { showNotifications } from "./lib/notify.ts";
import { getInstallId, loadSettings } from "./lib/settings.ts";
import { createSource } from "./lib/source.ts";

export const ALERT_TASK = "warden-alert-check";
const INTERVAL_MINUTES = 15;

const extra = (Constants.expoConfig?.extra ?? {}) as { apiUrl?: string };

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
  });
  if (options.notify) await showNotifications(result.notifications);
  return result;
}

// Must be defined when the JavaScript bundle loads, before any screen renders.
TaskManager.defineTask(ALERT_TASK, async () => {
  try {
    await runStoredAlertCheck({ notify: true });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** Turns background checks on or off to match the person's alert setting. */
export async function syncBackgroundChecks(enabled: boolean): Promise<boolean> {
  const registered = await TaskManager.isTaskRegisteredAsync(ALERT_TASK);
  if (!enabled) {
    if (registered) await BackgroundTask.unregisterTaskAsync(ALERT_TASK);
    return false;
  }
  const status = await BackgroundTask.getStatusAsync();
  if (status !== BackgroundTask.BackgroundTaskStatus.Available) return false;
  if (!registered) {
    await BackgroundTask.registerTaskAsync(ALERT_TASK, { minimumInterval: INTERVAL_MINUTES });
  }
  return true;
}
