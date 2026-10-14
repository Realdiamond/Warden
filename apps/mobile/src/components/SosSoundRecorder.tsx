// Records sound in 30-second clips while an SOS is on, if the person turned it on in Safety
// settings (M8). Each clip is sent to Warden for the person's contacts to hear on their private
// link. Android shows its own "recording" notification, so this is never hidden from the phone's
// owner; it is "stealth" only in that nothing on the screen draws attention to it.

import AsyncStorage from "@react-native-async-storage/async-storage";
import { SOS_CLIP_SECONDS } from "@warden/shared";
import { getRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder } from "expo-audio";
import { useEffect, useRef } from "react";
import { loadProfile } from "../lib/contacts.ts";
import { clipTooLarge } from "../lib/media.ts";
import { keepFile, removeFile } from "../lib/mediaFiles.ts";
import { VOICE_CONTENT_TYPE, VOICE_EXTENSION, VOICE_RECORDING } from "../lib/recording.ts";
import type { ActiveSession } from "../lib/safety.ts";
import { queueSosClip } from "../mediaRuntime.ts";

export function SosSoundRecorder({ session }: { session: ActiveSession | null }) {
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const sosId = session?.kind === "sos" ? (session.sessionId ?? "demo") : null;

  useEffect(() => {
    if (!sosId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let startedAt = new Date();

    /** Ends the current clip and hands it over to be sent. */
    const takeClip = async () => {
      if (!recorder.isRecording) return;
      await recorder.stop();
      const uri = recorder.uri;
      const current = sessionRef.current;
      if (!uri || !current) return;
      const kept = await keepFile(uri, VOICE_EXTENSION).catch(() => null);
      await removeFile(uri).catch(() => undefined);
      if (!kept) return;
      if (clipTooLarge(kept.bytes)) {
        await removeFile(kept.uri).catch(() => undefined);
        return;
      }
      await queueSosClip(current, {
        uri: kept.uri,
        contentType: VOICE_CONTENT_TYPE,
        recordedAt: startedAt,
      });
    };

    const next = async () => {
      if (stopped) return;
      try {
        await recorder.prepareToRecordAsync();
        startedAt = new Date();
        recorder.record();
      } catch {
        // The microphone is busy (a call, another app). Try again with the next clip.
      }
      timer = setTimeout(() => {
        void takeClip()
          .catch(() => undefined)
          .then(next);
      }, SOS_CLIP_SECONDS * 1000);
    };

    void (async () => {
      const profile = await loadProfile(AsyncStorage);
      if (!profile.recordSosSound || stopped) return;
      const permission = await getRecordingPermissionsAsync().catch(() => null);
      if (!permission?.granted || stopped) return;
      await setAudioModeAsync({
        allowsRecording: true,
        shouldPlayInBackground: true,
        allowsBackgroundRecording: true,
      }).catch(() => undefined);
      await next();
    })();

    return () => {
      stopped = true;
      clearTimeout(timer);
      // The SOS is over, so the server no longer takes clips: stop and delete the last one.
      void (async () => {
        if (recorder.isRecording) await recorder.stop().catch(() => undefined);
        if (recorder.uri) await removeFile(recorder.uri).catch(() => undefined);
        await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
      })();
    };
  }, [sosId, recorder]);

  return null;
}
