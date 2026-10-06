import type { Cipher, Hasher } from "../crypto.ts";
import type { Pool } from "../db/pool.ts";
import type { SmsSender } from "../sms/sender.ts";

/** Everything the services need, injected so tests can control time and randomness. */
export interface ServiceDeps {
  pool: Pool;
  cipher: Cipher;
  hasher: Hasher;
  now: () => Date;
  random: () => number;
  sms: SmsSender;
  smsHourlyCap: number;
  /** Public address for links sent to contacts; null when not configured. */
  publicWebUrl: string | null;
}

export function floorToMinute(date: Date): string {
  const copy = new Date(date.getTime());
  copy.setUTCSeconds(0, 0);
  return copy.toISOString();
}
