// Voice notes, photos and short videos (M8). Attached to a report, to an SOS (audio clips for
// trusted contacts) or to a responder broadcast (spoken message).
//
// Report media is Restricted: encrypted at rest, seen only by moderators and the responders an
// incident is shared with, never published, and deleted after MEDIA_RETENTION_DAYS. A voice or a
// face can identify a person, so nothing here ever reaches the public map.

import { z } from "zod";
import { CATEGORY_IDS } from "./categories.ts";

export const MEDIA_KINDS = ["audio", "photo", "video"] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** Content types accepted, and the kind each one is. */
export const MEDIA_TYPES: Record<string, MediaKind> = {
  "audio/mp4": "audio",
  "audio/m4a": "audio",
  "audio/aac": "audio",
  "audio/webm": "audio",
  "audio/ogg": "audio",
  "image/jpeg": "photo",
  "video/mp4": "video",
};

/** Byte limits, sized for a 60-second voice note, a resized photo and a 20-second video. */
export const MEDIA_MAX_BYTES: Record<MediaKind, number> = {
  audio: 1_500_000,
  photo: 2_000_000,
  video: 8_000_000,
};
export const MAX_AUDIO_SECONDS = 60;
export const MAX_VIDEO_SECONDS = 20;
export const MAX_MEDIA_PER_REPORT = 3;
export const MEDIA_RETENTION_DAYS = 30;
/** SOS audio is recorded in clips so each one can be sent as soon as it is done. */
export const SOS_CLIP_SECONDS = 30;
export const SOS_AUDIO_MAX_BYTES = 600_000;

export function mediaKindOf(contentType: string | undefined): MediaKind | null {
  if (!contentType) return null;
  return MEDIA_TYPES[contentType.split(";")[0]?.trim().toLowerCase() ?? ""] ?? null;
}

/** What moderators see about an attachment before opening it. */
export interface ReportMediaInfo {
  id: string;
  kind: MediaKind;
  contentType: string;
  bytes: number;
  createdAt: string;
}

/** An SOS audio clip, listed on the contacts' live page. */
export interface SessionClip {
  id: string;
  recordedAt: string;
  bytes: number;
}

/** A possible incident found in a news feed, waiting for a moderator (M8). */
export interface NewsLead {
  id: string;
  source: string;
  url: string;
  title: string;
  summary: string | null;
  publishedAt: string | null;
  categoryId: string | null;
  place: string | null;
  createdAt: string;
}

export const NewsDecisionSchema = z.strictObject({
  action: z.enum(["add", "dismiss"]),
  categoryId: z.enum(CATEGORY_IDS).optional(),
  reason: z.string().trim().max(500).optional(),
});
export type NewsDecision = z.input<typeof NewsDecisionSchema>;
