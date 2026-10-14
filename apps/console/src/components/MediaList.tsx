// Report attachments (M8). Each file is fetched only when a moderator chooses to open it,
// because every opening is written to the audit log.

import type { ReportMediaInfo } from "@warden/shared";
import { useEffect, useState } from "react";

const LABEL: Record<ReportMediaInfo["kind"], string> = {
  audio: "Voice note",
  photo: "Photo",
  video: "Video",
};

function size(bytes: number): string {
  return bytes < 1_000_000
    ? `${Math.round(bytes / 1000)} KB`
    : `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function MediaItem({ item, urlFor }: { item: ReportMediaInfo; urlFor: (id: string) => string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );

  async function open() {
    setError(null);
    try {
      const response = await fetch(urlFor(item.id), {
        credentials: "same-origin",
        headers: { "x-warden-console": "1" },
      });
      if (!response.ok) throw new Error(`Could not open the file (${response.status}).`);
      setUrl(URL.createObjectURL(await response.blob()));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open the file.");
    }
  }

  return (
    <li className="media-item">
      {!url && (
        <button type="button" onClick={() => void open()}>
          Open {LABEL[item.kind].toLowerCase()} ({size(item.bytes)})
        </button>
      )}
      {url && item.kind === "audio" && (
        // biome-ignore lint/a11y/useMediaCaption: reporters' voice notes have no captions.
        <audio controls src={url} />
      )}
      {url && item.kind === "photo" && (
        <img src={url} alt="Sent with the report" className="media-photo" />
      )}
      {url && item.kind === "video" && (
        // biome-ignore lint/a11y/useMediaCaption: reporters' videos have no captions.
        <video controls src={url} className="media-photo" />
      )}
      {error && <span className="error">{error}</span>}
    </li>
  );
}

export function MediaList({
  media,
  urlFor,
}: {
  media: ReportMediaInfo[];
  urlFor: (id: string) => string;
}) {
  if (media.length === 0) return null;
  return (
    <div>
      <p className="muted">
        Sent with the report. Opening a file is recorded in the audit log. Files are deleted after
        30 days and never shown to the public.
      </p>
      <ul className="media-list">
        {media.map((item) => (
          <MediaItem key={item.id} item={item} urlFor={urlFor} />
        ))}
      </ul>
    </div>
  );
}
