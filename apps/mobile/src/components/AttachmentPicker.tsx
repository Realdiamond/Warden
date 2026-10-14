// Adds a voice note, photo or video to a report (M8). Files are copied into Warden's private
// folder on the phone and sent after the report itself. Only trained staff can open them.

import { MAX_MEDIA_PER_REPORT, mediaKindOf } from "@warden/shared";
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";
import * as ImagePicker from "expo-image-picker";
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { type Attachment, attachmentProblem } from "../lib/media.ts";
import { keepFile, removeFile } from "../lib/mediaFiles.ts";
import { VOICE_CONTENT_TYPE, VOICE_EXTENSION, VOICE_RECORDING } from "../lib/recording.ts";
import { COLORS } from "../lib/ui.ts";
import { Button, Icon } from "./ui.tsx";

const VOICE_MAX_SECONDS = 60;
const VIDEO_MAX_SECONDS = 20;

const LABEL = { audio: "Voice note", photo: "Photo", video: "Video" } as const;
const ICON = { audio: "microphone", photo: "image", video: "video" } as const;

function extensionFor(contentType: string): string {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "video/mp4") return "mp4";
  return VOICE_EXTENSION;
}

export function AttachmentPicker({
  attachments,
  onChange,
}: {
  attachments: Attachment[];
  onChange: (next: Attachment[]) => void;
}) {
  const recorder = useAudioRecorder(VOICE_RECORDING);
  const recording = useAudioRecorderState(recorder, 500);
  const [message, setMessage] = useState<string | null>(null);
  const limit = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Leaving the screen while recording stops the microphone.
  useEffect(() => () => clearTimeout(limit.current), []);
  const full = attachments.length >= MAX_MEDIA_PER_REPORT;

  async function add(file: { uri: string; contentType: string; bytes: number }) {
    const problem = attachmentProblem(file, attachments.length);
    const kind = mediaKindOf(file.contentType);
    if (problem || !kind) {
      setMessage(problem ?? "This kind of file cannot be sent.");
      return;
    }
    const kept = await keepFile(file.uri, extensionFor(file.contentType)).catch(() => null);
    if (!kept) {
      setMessage("Could not save the file on this phone.");
      return;
    }
    onChange([
      ...attachments,
      { uri: kept.uri, contentType: file.contentType, kind, bytes: kept.bytes || file.bytes },
    ]);
  }

  async function startVoice() {
    setMessage(null);
    const permission = await requestRecordingPermissionsAsync().catch(() => null);
    if (!permission?.granted) {
      setMessage("Warden needs the microphone to record a voice note.");
      return;
    }
    await setAudioModeAsync({ allowsRecording: true }).catch(() => undefined);
    await recorder.prepareToRecordAsync();
    recorder.record();
    limit.current = setTimeout(() => void stopVoice(), VOICE_MAX_SECONDS * 1000);
  }

  async function stopVoice() {
    clearTimeout(limit.current);
    if (!recorder.isRecording) return;
    await recorder.stop();
    await setAudioModeAsync({ allowsRecording: false }).catch(() => undefined);
    const uri = recorder.uri;
    if (!uri) return;
    await add({ uri, contentType: VOICE_CONTENT_TYPE, bytes: 0 });
    await removeFile(uri).catch(() => undefined);
  }

  async function pick(from: "camera" | "library", media: "images" | "videos" | "both") {
    setMessage(null);
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: media === "both" ? ["images", "videos"] : media,
      quality: 0.6,
      exif: false,
      videoMaxDuration: VIDEO_MAX_SECONDS,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.Low,
    };
    if (from === "camera") {
      const permission = await ImagePicker.requestCameraPermissionsAsync().catch(() => null);
      if (!permission?.granted) {
        setMessage("Warden needs the camera for this.");
        return;
      }
    }
    const result =
      from === "camera"
        ? await ImagePicker.launchCameraAsync(options).catch(() => null)
        : await ImagePicker.launchImageLibraryAsync(options).catch(() => null);
    const asset = result && !result.canceled ? result.assets[0] : null;
    if (!asset) return;
    const contentType = asset.mimeType ?? (asset.type === "video" ? "video/mp4" : "image/jpeg");
    if (contentType.startsWith("image/") && contentType !== "image/jpeg") {
      setMessage("Only JPEG photos can be sent. Take the photo with the camera instead.");
      return;
    }
    await add({ uri: asset.uri, contentType, bytes: asset.fileSize ?? 0 });
  }

  return (
    <View style={styles.box}>
      <Text style={styles.title}>Add a voice note, photo or video (optional)</Text>
      <Text style={styles.help}>
        Only trained Warden staff can see them. Never film someone in danger if it puts you at risk.
        Files are deleted after 30 days.
      </Text>
      {attachments.map((file, index) => (
        <View key={file.uri} style={styles.row}>
          <Icon name={ICON[file.kind]} color={COLORS.primary} />
          <Text style={styles.rowText}>
            {LABEL[file.kind]}
            {file.bytes > 0 ? ` · ${Math.max(1, Math.round(file.bytes / 1000))} KB` : ""}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${LABEL[file.kind].toLowerCase()}`}
            onPress={() => {
              void removeFile(file.uri).catch(() => undefined);
              onChange(attachments.filter((_, i) => i !== index));
            }}
            hitSlop={12}
          >
            <Icon name="close" color={COLORS.muted} />
          </Pressable>
        </View>
      ))}
      {recording.isRecording ? (
        <Button
          label={`Stop recording (${Math.floor(recording.durationMillis / 1000)}s of ${VOICE_MAX_SECONDS}s)`}
          icon="stop-circle"
          variant="danger"
          onPress={() => void stopVoice()}
        />
      ) : (
        !full && (
          <View style={styles.buttons}>
            <Button label="Record voice note" icon="microphone" onPress={() => void startVoice()} />
            <Button
              label="Take a photo"
              icon="camera"
              onPress={() => void pick("camera", "images")}
            />
            <Button
              label={`Record video (${VIDEO_MAX_SECONDS}s)`}
              icon="video"
              onPress={() => void pick("camera", "videos")}
            />
            <Button
              label="Choose from phone"
              icon="image-multiple"
              onPress={() => void pick("library", "both")}
            />
          </View>
        )
      )}
      {message && <Text style={styles.error}>{message}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: 14,
    gap: 8,
    borderRadius: 14,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  title: { fontSize: 15, fontWeight: "600", color: COLORS.text },
  help: { color: COLORS.muted, fontSize: 13 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 4 },
  rowText: { flex: 1, color: COLORS.text },
  buttons: { gap: 8 },
  error: { color: COLORS.danger },
});
