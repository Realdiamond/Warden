// Text messages to trusted contacts. The "log" sender is the default until an SMS provider
// account exists: it records that a message would have gone out, never the number or text.

export type SmsResult = { ok: true } | { ok: false; retry: boolean; error: string };

export interface SmsSender {
  readonly name: string;
  send(to: string, text: string): Promise<SmsResult>;
}

export class LogSmsSender implements SmsSender {
  readonly name = "log";
  readonly #log: (entry: Record<string, unknown>) => void;

  constructor(log: (entry: Record<string, unknown>) => void) {
    this.#log = log;
  }

  async send(_to: string, text: string): Promise<SmsResult> {
    this.#log({ sms: "not sent (no provider configured)", length: text.length });
    return { ok: true };
  }
}

/** Keeps messages in memory; for tests. */
export class MemorySmsSender implements SmsSender {
  readonly name = "memory";
  readonly sent: { to: string; text: string }[] = [];
  failNext = 0;

  async send(to: string, text: string): Promise<SmsResult> {
    if (this.failNext > 0) {
      this.failNext -= 1;
      return { ok: false, retry: true, error: "simulated failure" };
    }
    this.sent.push({ to, text });
    return { ok: true };
  }
}

export interface TermiiOptions {
  apiKey: string;
  senderId: string;
  baseUrl: string;
  fetchImpl?: typeof fetch;
}

/**
 * Termii (a Nigerian SMS gateway). Written against Termii's public "send message" API but not
 * yet tried with a live account: test with a real key before relying on it.
 */
export class TermiiSmsSender implements SmsSender {
  readonly name = "termii";
  readonly #options: TermiiOptions;

  constructor(options: TermiiOptions) {
    this.#options = options;
  }

  async send(to: string, text: string): Promise<SmsResult> {
    const fetchImpl = this.#options.fetchImpl ?? fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(
        `${this.#options.baseUrl.replace(/\/+$/, "")}/api/sms/send`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: this.#options.apiKey,
            to: to.replace(/^\+/, ""),
            from: this.#options.senderId,
            sms: text,
            type: "plain",
            // The "dnd" route reaches numbers on Do-Not-Disturb, which matters for safety messages.
            channel: "dnd",
          }),
          signal: controller.signal,
        },
      );
      if (response.ok) return { ok: true };
      return {
        ok: false,
        retry: response.status >= 500 || response.status === 429,
        error: `Termii responded ${response.status}`,
      };
    } catch {
      return { ok: false, retry: true, error: "Termii unreachable" };
    } finally {
      clearTimeout(timer);
    }
  }
}
