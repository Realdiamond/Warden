// In-memory fixed-window rate limiter. Keys are keyed hashes, never raw identifiers, and
// nothing is persisted. A multi-server deployment will move this to Valkey.

export interface RateLimitResult {
  allowed: boolean;
  retryAfterMs: number;
}

export class RateLimiter {
  readonly limit: number;
  readonly windowMs: number;
  readonly #windows = new Map<string, { start: number; count: number }>();

  constructor(limit: number, windowMs: number) {
    this.limit = limit;
    this.windowMs = windowMs;
  }

  hit(key: string, nowMs: number): RateLimitResult {
    if (this.#windows.size > 50_000) this.#purge(nowMs);
    const window = this.#windows.get(key);
    if (!window || nowMs - window.start >= this.windowMs) {
      this.#windows.set(key, { start: nowMs, count: 1 });
      return { allowed: true, retryAfterMs: 0 };
    }
    if (window.count >= this.limit) {
      return { allowed: false, retryAfterMs: window.start + this.windowMs - nowMs };
    }
    window.count += 1;
    return { allowed: true, retryAfterMs: 0 };
  }

  #purge(nowMs: number): void {
    for (const [key, window] of this.#windows) {
      if (nowMs - window.start >= this.windowMs) this.#windows.delete(key);
    }
  }
}
