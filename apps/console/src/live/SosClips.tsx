// Sound recorded by the phone during an SOS (M8), for the people the person chose to tell.
// Clips are fetched only when someone presses play, with the private link's token.

import type { SessionClip } from "@warden/shared";
import { useEffect, useState } from "react";
import { fetchClips, fetchClipUrl } from "./liveApi.ts";

const POLL_MS = 20_000;

function Clip({
  clip,
  sessionId,
  viewToken,
}: {
  clip: SessionClip;
  sessionId: string;
  viewToken: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const time = new Date(clip.recordedAt).toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  return (
    <li>
      <span>Recorded at {time}</span>
      {url ? (
        // biome-ignore lint/a11y/useMediaCaption: live recordings have no captions.
        <audio controls autoPlay src={url} />
      ) : (
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            void fetchClipUrl(sessionId, viewToken, clip.id).then((u) =>
              u ? setUrl(u) : setFailed(true),
            );
          }}
        >
          Listen
        </button>
      )}
      {failed && <span className="live-note">Could not load this clip. Try again.</span>}
    </li>
  );
}

export function SosClips({
  sessionId,
  viewToken,
  live,
}: {
  sessionId: string;
  viewToken: string;
  live: boolean;
}) {
  const [clips, setClips] = useState<SessionClip[]>([]);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      const next = await fetchClips(sessionId, viewToken);
      if (stopped) return;
      setClips(next);
      if (live) timer = setTimeout(() => void load(), POLL_MS);
    };
    void load();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [sessionId, viewToken, live]);

  if (clips.length === 0) return null;
  return (
    <section className="live-clips" aria-label="Sound from their phone">
      <h2>Sound from their phone</h2>
      <p className="live-note">
        Their phone records short clips while the SOS is on. They may help you understand what is
        happening. Clips are deleted after 30 days.
      </p>
      <ul>
        {clips.map((clip) => (
          <Clip key={clip.id} clip={clip} sessionId={sessionId} viewToken={viewToken} />
        ))}
      </ul>
    </section>
  );
}
