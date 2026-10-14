// Voice notes, photos and videos sent with reports, and sound recorded during an SOS (M8).
//
// Files are copied into the app's own storage first, then sent one by one. A file waits on the
// phone while there is no signal, and is deleted from the phone once the server has it or has
// refused it for good. Nothing here is ever shown publicly.

import {
  MAX_MEDIA_PER_REPORT,
  MEDIA_MAX_BYTES,
  type MediaKind,
  mediaKindOf,
  SOS_AUDIO_MAX_BYTES,
} from "@warden/shared";
import type { KeyValueStore } from "./outbox.ts";

/** A file the person chose for a report that has not been sent yet. */
export interface Attachment {
  uri: string;
  contentType: string;
  kind: MediaKind;
  bytes: number;
}

interface UploadBase {
  id: string;
  uri: string;
  contentType: string;
  attempts: number;
}

export type MediaUpload =
  | (UploadBase & { target: "report"; reportId: string; statusToken: string })
  | (UploadBase & {
      target: "session";
      sessionId: string;
      controlToken: string;
      recordedAt: string;
    });

/** What sending one file came to. */
export type UploadOutcome = "sent" | "retry" | "refused";

export type Uploader = (item: MediaUpload) => Promise<UploadOutcome>;

const QUEUE_KEY = "warden.mediaQueue.v1";
/** After this many failed tries a file is given up on, so a queue can never grow forever. */
export const MAX_UPLOAD_ATTEMPTS = 20;
/** At most this many SOS clips wait on the phone; the oldest are dropped first. */
const MAX_QUEUED_CLIPS = 40;

/** Why a file cannot be attached, or null when it can. */
export function attachmentProblem(
  file: { contentType: string; bytes: number },
  alreadyAttached: number,
): string | null {
  const kind = mediaKindOf(file.contentType);
  if (!kind) return "This kind of file cannot be sent.";
  if (alreadyAttached >= MAX_MEDIA_PER_REPORT) {
    return `You can add up to ${MAX_MEDIA_PER_REPORT} files to a report.`;
  }
  if (file.bytes > MEDIA_MAX_BYTES[kind]) {
    return kind === "video"
      ? "This video is too large. Record a shorter one (about 20 seconds)."
      : "This file is too large to send.";
  }
  return null;
}

/** An SOS clip that is too large is not worth the person's data. */
export function clipTooLarge(bytes: number): boolean {
  return bytes > SOS_AUDIO_MAX_BYTES;
}

export class MediaQueue {
  readonly #store: KeyValueStore;
  readonly #remove: (uri: string) => Promise<void>;
  #flushing: Promise<MediaFlushResult> | null = null;
  /** Changes to the stored queue happen one at a time. */
  #lock: Promise<unknown> = Promise.resolve();

  /** `remove` deletes a file from the phone once it is no longer needed. */
  constructor(store: KeyValueStore, remove: (uri: string) => Promise<void>) {
    this.#store = store;
    this.#remove = remove;
  }

  async pending(): Promise<MediaUpload[]> {
    const raw = await this.#store.getItem(QUEUE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      return Array.isArray(parsed) ? (parsed as MediaUpload[]) : [];
    } catch {
      return [];
    }
  }

  #mutate(change: (queue: MediaUpload[]) => Promise<MediaUpload[]>): Promise<void> {
    const run = this.#lock.then(async () => {
      const next = await change(await this.pending());
      await this.#store.setItem(QUEUE_KEY, JSON.stringify(next));
    });
    this.#lock = run.catch(() => undefined);
    return run;
  }

  add(items: MediaUpload[]): Promise<void> {
    if (items.length === 0) return Promise.resolve();
    return this.#mutate(async (current) => {
      const queue = [...current, ...items];
      const clips = queue.filter((item) => item.target === "session");
      if (clips.length <= MAX_QUEUED_CLIPS) return queue;
      const drop = new Set(clips.slice(0, clips.length - MAX_QUEUED_CLIPS).map((c) => c.id));
      for (const item of queue) {
        if (drop.has(item.id)) await this.#remove(item.uri).catch(() => undefined);
      }
      return queue.filter((item) => !drop.has(item.id));
    });
  }

  /** Sends waiting files in order. Concurrent calls share one run. */
  flush(upload: Uploader): Promise<MediaFlushResult> {
    this.#flushing ??= this.#flush(upload).finally(() => {
      this.#flushing = null;
    });
    return this.#flushing;
  }

  async #flush(upload: Uploader): Promise<MediaFlushResult> {
    const queue = await this.pending();
    const keep: MediaUpload[] = [];
    const result: MediaFlushResult = { sent: 0, refused: 0, waiting: 0 };
    let offline = false;
    for (const item of queue) {
      // After one network failure the rest would fail too; keep them, untried, for next time.
      if (offline) {
        keep.push(item);
        result.waiting += 1;
        continue;
      }
      const outcome = await upload(item).catch((): UploadOutcome => "retry");
      if (outcome === "retry") {
        offline = true;
        const attempts = item.attempts + 1;
        if (attempts >= MAX_UPLOAD_ATTEMPTS) {
          await this.#remove(item.uri).catch(() => undefined);
          result.refused += 1;
        } else {
          keep.push({ ...item, attempts });
          result.waiting += 1;
        }
        continue;
      }
      await this.#remove(item.uri).catch(() => undefined);
      if (outcome === "sent") result.sent += 1;
      else result.refused += 1;
    }
    // Files added while this run was sending stay queued.
    const done = new Set(queue.map((item) => item.id));
    await this.#mutate(async (current) => [
      ...keep,
      ...current.filter((item) => !done.has(item.id)),
    ]);
    return result;
  }

  /** Deletes files that will never be sent, such as those of a refused report. */
  async discard(uris: string[]): Promise<void> {
    for (const uri of uris) await this.#remove(uri).catch(() => undefined);
  }

  /** Shared-phone safety: deletes every waiting file. */
  async clear(): Promise<void> {
    await this.#flushing?.catch(() => undefined);
    await this.#mutate(async (current) => {
      for (const item of current) await this.#remove(item.uri).catch(() => undefined);
      return [];
    });
  }
}

export interface MediaFlushResult {
  sent: number;
  refused: number;
  waiting: number;
}

/** Turns attachments of a report the server accepted into uploads. */
export function uploadsForReport(
  attachments: Attachment[],
  receipt: { reportId: string; statusToken: string },
  makeId: () => string,
): MediaUpload[] {
  return attachments.map((file) => ({
    id: makeId(),
    target: "report",
    reportId: receipt.reportId,
    statusToken: receipt.statusToken,
    uri: file.uri,
    contentType: file.contentType,
    attempts: 0,
  }));
}

/** How the status of a server reply maps to what the queue does next. */
export function outcomeForStatus(status: number): UploadOutcome {
  if (status >= 200 && status < 300) return "sent";
  if (status === 429 || status >= 500 || status === 408) return "retry";
  return "refused";
}
