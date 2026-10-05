// Offline-first reporting: every report is saved on the phone first, then sent. Retries reuse
// the same idempotency key, so a report is never stored twice on the server.

import type { CategoryId, ReportSubmission } from "@warden/shared";
import type { SendResult } from "./api.ts";

export interface KeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface PendingReport {
  idempotencyKey: string;
  body: ReportSubmission;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

export interface SavedReport {
  reportId: string;
  statusToken: string;
  categoryId: CategoryId;
  createdAt: string;
}

export interface RejectedReport {
  categoryId: CategoryId;
  createdAt: string;
  message: string;
}

export type Sender = (body: ReportSubmission, idempotencyKey: string) => Promise<SendResult>;

const OUTBOX_KEY = "warden.outbox.v1";
const SENT_KEY = "warden.myReports.v1";
const REJECTED_KEY = "warden.rejected.v1";
const MAX_HISTORY = 50;

async function readList<T>(store: KeyValueStore, key: string): Promise<T[]> {
  const raw = await store.getItem(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export class Outbox {
  readonly #store: KeyValueStore;
  #flushing: Promise<FlushResult> | null = null;

  constructor(store: KeyValueStore) {
    this.#store = store;
  }

  pending(): Promise<PendingReport[]> {
    return readList<PendingReport>(this.#store, OUTBOX_KEY);
  }

  sent(): Promise<SavedReport[]> {
    return readList<SavedReport>(this.#store, SENT_KEY);
  }

  rejected(): Promise<RejectedReport[]> {
    return readList<RejectedReport>(this.#store, REJECTED_KEY);
  }

  async add(body: ReportSubmission, idempotencyKey: string, now: Date): Promise<void> {
    const pending = await this.pending();
    pending.push({ idempotencyKey, body, createdAt: now.toISOString(), attempts: 0 });
    await this.#store.setItem(OUTBOX_KEY, JSON.stringify(pending));
  }

  /** Sends queued reports one by one. Concurrent calls share the same run. */
  flush(send: Sender): Promise<FlushResult> {
    this.#flushing ??= this.#flush(send).finally(() => {
      this.#flushing = null;
    });
    return this.#flushing;
  }

  async #flush(send: Sender): Promise<FlushResult> {
    const queue = await this.pending();
    const keep: PendingReport[] = [];
    const sent = await this.sent();
    const rejected = await this.rejected();
    const result: FlushResult = { sent: 0, rejected: 0, waiting: 0 };

    for (const item of queue) {
      const outcome = await send(item.body, item.idempotencyKey);
      if (outcome.ok) {
        sent.unshift({
          reportId: outcome.receipt.reportId,
          statusToken: outcome.receipt.statusToken,
          categoryId: item.body.categoryId,
          createdAt: item.createdAt,
        });
        result.sent += 1;
      } else if (outcome.retry) {
        keep.push({ ...item, attempts: item.attempts + 1, lastError: outcome.message });
        result.waiting += 1;
      } else {
        rejected.unshift({
          categoryId: item.body.categoryId,
          createdAt: item.createdAt,
          message: outcome.message,
        });
        result.rejected += 1;
      }
    }

    await this.#store.setItem(OUTBOX_KEY, JSON.stringify(keep));
    await this.#store.setItem(SENT_KEY, JSON.stringify(sent.slice(0, MAX_HISTORY)));
    await this.#store.setItem(REJECTED_KEY, JSON.stringify(rejected.slice(0, MAX_HISTORY)));
    return result;
  }

  /** Shared-phone safety: forget which reports this phone made. Unsent reports are kept. */
  async clearHistory(): Promise<void> {
    await this.#store.removeItem(SENT_KEY);
    await this.#store.removeItem(REJECTED_KEY);
  }
}

export interface FlushResult {
  sent: number;
  rejected: number;
  waiting: number;
}
