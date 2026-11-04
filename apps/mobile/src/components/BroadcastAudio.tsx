// Plays the spoken version of a verified broadcast (M8), after checking it is the recording the
// responder signed.

import type { SignedBroadcast } from "@warden/shared";
import { type AudioPlayer, createAudioPlayer } from "expo-audio";
import { useEffect, useRef, useState } from "react";
import { verifiedBroadcastAudio } from "../lib/broadcasts.ts";
import { writeTemp } from "../lib/mediaFiles.ts";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";
import { Button } from "./ui.tsx";

export function BroadcastAudio({
  broadcast,
  download,
}: {
  broadcast: SignedBroadcast;
  download: (id: string) => Promise<Uint8Array | null>;
}) {
  const c = useTheme();
  const [state, setState] = useState<"idle" | "loading" | "playing" | "failed">("idle");
  const player = useRef<AudioPlayer | null>(null);

  useEffect(
    () => () => {
      player.current?.remove();
    },
    [],
  );

  if (!broadcast.audioSha256) return null;

  async function play() {
    if (player.current) {
      player.current.seekTo(0);
      player.current.play();
      setState("playing");
      return;
    }
    setState("loading");
    const bytes = await verifiedBroadcastAudio(broadcast, download).catch(() => null);
    if (!bytes) {
      setState("failed");
      return;
    }
    const uri = writeTemp(bytes, "audio");
    player.current = createAudioPlayer({ uri });
    player.current.play();
    setState("playing");
  }

  return (
    <>
      <Button
        label={state === "loading" ? "Loading…" : "Listen to this message"}
        icon="volume-high"
        disabled={state === "loading"}
        onPress={() => void play()}
      />
      {state === "failed" && (
        <Text style={{ color: c.muted, fontSize: 14, lineHeight: 20 }}>
          The spoken message could not be checked, so it was not played. The written message above
          is the official one.
        </Text>
      )}
    </>
  );
}
