// Local notifications and spoken alerts. Alerts are shown by the phone itself after it checks
// the feed, so no push service (and no Google account link) is needed.

import * as Notifications from "expo-notifications";
import * as Speech from "expo-speech";
import { Platform } from "react-native";
import type { NotificationChannel, PlannedNotification } from "./alerts.ts";

const CHANNELS: Record<
  NotificationChannel,
  { name: string; description: string; importance: Notifications.AndroidImportance; sound: boolean }
> = {
  critical: {
    name: "Danger nearby",
    description: "Kidnapping, shooting, attacks and other critical incidents near your places.",
    importance: Notifications.AndroidImportance.MAX,
    sound: true,
  },
  warning: {
    name: "Warnings",
    description: "Serious incidents near your places, such as robberies.",
    importance: Notifications.AndroidImportance.HIGH,
    sound: true,
  },
  advisory: {
    name: "Advisories",
    description: "Less serious incidents near your places.",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: true,
  },
  updates: {
    name: "Updates",
    description: "When an incident you were told about is over or corrected.",
    importance: Notifications.AndroidImportance.LOW,
    sound: false,
  },
  quiet: {
    name: "Quiet hours",
    description: "Alerts during your quiet hours, shown without sound.",
    importance: Notifications.AndroidImportance.LOW,
    sound: false,
  },
};

let channelsReady: Promise<void> | null = null;

export function setUpNotifications(): Promise<void> {
  if (!channelsReady) {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowBanner: true,
        shouldShowList: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
      }),
    });
    channelsReady =
      Platform.OS === "android"
        ? Promise.all(
            Object.entries(CHANNELS).map(([id, channel]) =>
              Notifications.setNotificationChannelAsync(id, {
                name: channel.name,
                description: channel.description,
                importance: channel.importance,
                sound: channel.sound ? "default" : null,
                enableVibrate: channel.sound,
                vibrationPattern: channel.sound ? [0, 400, 200, 400] : null,
                // Lock screen shows that there is an alert, not the details.
                lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
              }),
            ),
          ).then(() => undefined)
        : Promise.resolve();
  }
  return channelsReady;
}

export async function notificationsAllowed(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  return current.granted;
}

/** Asks once, when the person turns alerts on; Android 13+ needs this permission. */
export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  if (!current.canAskAgain) return false;
  const result = await Notifications.requestPermissionsAsync();
  return result.granted;
}

export async function showNotifications(planned: PlannedNotification[]): Promise<void> {
  if (planned.length === 0) return;
  await setUpNotifications();
  for (const item of planned) {
    await Notifications.scheduleNotificationAsync({
      identifier: item.alertId,
      content: {
        title: item.title,
        body: item.body,
        data: { alertId: item.alertId, incidentId: item.incidentId },
      },
      trigger: { channelId: item.channel },
    });
  }
}

export function speakAlerts(planned: PlannedNotification[]): void {
  for (const item of planned) {
    if (item.speech) Speech.speak(item.speech, { language: "en", rate: 0.95 });
  }
}

/** The alert behind a notification the person tapped, if any. */
export function alertIdFromResponse(
  response: Notifications.NotificationResponse | null | undefined,
): string | null {
  const data = response?.notification.request.content.data as { alertId?: unknown } | undefined;
  return typeof data?.alertId === "string" ? data.alertId : null;
}
