// Sends files waiting on the phone (M8): report attachments and SOS sound. Shared by the
// screens, the SOS recorder and the background check.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { randomUUID } from "expo-crypto";
import { MediaQueue } from "./lib/media.ts";
import { removeFile, sendFile } from "./lib/mediaFiles.ts";
import type { ActiveSession } from "./lib/safety.ts";
import { storedSource } from "./safetyRuntime.ts";

export const mediaQueue = new MediaQueue(AsyncStorage, removeFile);

/** Sends what it can now; the rest waits for the next try. */
export async function flushMedia(): Promise<void> {
  const source = await storedSource();
  await mediaQueue.flush((item) => source.uploadMedia(item, sendFile));
}

/** Queues a clip recorded during an SOS and tries to send it straight away. */
export async function queueSosClip(
  session: ActiveSession,
  file: { uri: string; contentType: string; recordedAt: Date },
): Promise<void> {
  if (!session.sessionId || !session.controlToken) {
    // Demo SOS: nothing is sent anywhere.
    await removeFile(file.uri).catch(() => undefined);
    return;
  }
  await mediaQueue.add([
    {
      id: randomUUID(),
      target: "session",
      sessionId: session.sessionId,
      controlToken: session.controlToken,
      recordedAt: file.recordedAt.toISOString(),
      uri: file.uri,
      contentType: file.contentType,
      attempts: 0,
    },
  ]);
  await flushMedia().catch(() => undefined);
}
