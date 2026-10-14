// Records a short spoken message in the browser (M8), for broadcasts read aloud on phones.

import { useEffect, useRef, useState } from "react";

export interface Recording {
  contentType: "audio/webm" | "audio/ogg" | "audio/mp4";
  /** Base64 of the recorded bytes. */
  data: string;
  url: string;
  seconds: number;
}

const MAX_SECONDS = 60;
const TYPES = ["audio/webm", "audio/ogg", "audio/mp4"] as const;

function baseType(mimeType: string): Recording["contentType"] | null {
  const base = mimeType.split(";")[0]?.trim().toLowerCase();
  return TYPES.find((t) => t === base) ?? null;
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function VoiceRecorder({
  value,
  onChange,
}: {
  value: Recording | null;
  onChange: (recording: Recording | null) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(
    () => () => {
      if (value) URL.revokeObjectURL(value.url);
    },
    [value],
  );

  useEffect(() => {
    if (!recording) return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - started) / 1000);
      setSeconds(elapsed);
      if (elapsed >= MAX_SECONDS) recorder.current?.stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  // Leaving the page while recording releases the microphone.
  useEffect(
    () => () => {
      for (const track of recorder.current?.stream.getTracks() ?? []) track.stop();
    },
    [],
  );

  async function start() {
    setError(null);
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) {
      setError("This browser cannot record sound.");
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError("The browser did not allow the microphone.");
      return;
    }
    const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const media = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
    const chunks: Blob[] = [];
    const started = Date.now();
    media.ondataavailable = (event) => chunks.push(event.data);
    media.onstop = () => {
      for (const track of stream.getTracks()) track.stop();
      setRecording(false);
      const contentType = baseType(media.mimeType);
      if (!contentType) {
        setError("This browser records in a format phones cannot play.");
        return;
      }
      const blob = new Blob(chunks, { type: contentType });
      void toBase64(blob).then((data) =>
        onChange({
          contentType,
          data,
          url: URL.createObjectURL(blob),
          seconds: Math.round((Date.now() - started) / 1000),
        }),
      );
    };
    recorder.current = media;
    onChange(null);
    setSeconds(0);
    media.start();
    setRecording(true);
  }

  return (
    <div className="voice-recorder">
      {recording ? (
        <button type="button" className="danger" onClick={() => recorder.current?.stop()}>
          Stop recording ({seconds}s of {MAX_SECONDS}s)
        </button>
      ) : (
        <button type="button" onClick={() => void start()}>
          {value ? "Record again" : "Record a spoken version"}
        </button>
      )}
      {value && !recording && (
        <>
          {/* biome-ignore lint/a11y/useMediaCaption: the written message is the caption. */}
          <audio controls src={value.url} />
          <button type="button" className="link-button" onClick={() => onChange(null)}>
            Remove
          </button>
        </>
      )}
      {error && <span className="error">{error}</span>}
    </div>
  );
}
