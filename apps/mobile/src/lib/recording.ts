// Recording settings shared by voice notes and SOS sound (M8): small mono AAC files that phones
// and browsers can play. About 4 KB a second, so a 30-second clip is roughly 120 KB.

import { type RecordingOptions, RecordingPresets } from "expo-audio";

export const VOICE_RECORDING: RecordingOptions = {
  ...RecordingPresets.HIGH_QUALITY,
  sampleRate: 22_050,
  numberOfChannels: 1,
  bitRate: 32_000,
};

/** expo-audio writes MPEG-4 audio (.m4a) on Android with these settings. */
export const VOICE_CONTENT_TYPE = "audio/mp4";
export const VOICE_EXTENSION = "m4a";
