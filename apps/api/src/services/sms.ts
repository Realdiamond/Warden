// Queue and send text messages. Numbers and texts are encrypted in the queue; caps per number
// and per hour stop anyone using Warden to flood someone's phone.

import { type Client, withTransaction } from "../db/pool.ts";
import type { ServiceDeps } from "./deps.ts";

/** At most this many messages to one number in a day. */
export const SMS_PER_NUMBER_PER_DAY = 10;
const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000];
const BATCH = 20;

interface QueuedMessage {
  to: string;
  text: string;
}

/** Returns false when a cap stops the message. */
export async function queueSms(
  client: Client,
  deps: ServiceDeps,
  message: { sessionId: string | null; event: string; to: string; text: string },
): Promise<boolean> {
  const now = deps.now();
  const toHash = deps.hasher.hmac("sms-recipient", message.to);
  const { rows } = await client.query<{ to_number: number; last_hour: number }>(
    `SELECT count(*) FILTER (WHERE to_hash = $1 AND created_at > $2)::int AS to_number,
            count(*) FILTER (WHERE created_at > $3)::int AS last_hour
       FROM sms_outbox WHERE created_at > $2`,
    [toHash, new Date(now.getTime() - 24 * 3_600_000), new Date(now.getTime() - 3_600_000)],
  );
  const counts = rows[0] ?? { to_number: 0, last_hour: 0 };
  if (counts.to_number >= SMS_PER_NUMBER_PER_DAY || counts.last_hour >= deps.smsHourlyCap) {
    return false;
  }
  const body: QueuedMessage = { to: message.to, text: message.text };
  await client.query(
    `INSERT INTO sms_outbox (session_id, event, to_hash, key_id, message_enc, next_attempt_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6)`,
    [
      message.sessionId,
      message.event,
      toHash,
      deps.cipher.currentKeyId,
      deps.cipher.encryptJson("sms.message", body),
      now,
    ],
  );
  return true;
}

/** Sends due messages. Safe to run from several places: rows are claimed with SKIP LOCKED. */
export async function deliverDueSms(deps: ServiceDeps): Promise<{ sent: number; failed: number }> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<{
      id: string;
      key_id: string;
      message_enc: Buffer;
      attempts: number;
    }>(
      `SELECT id, key_id, message_enc, attempts FROM sms_outbox
        WHERE sent_at IS NULL AND failed_at IS NULL AND next_attempt_at <= $1
        ORDER BY next_attempt_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED`,
      [now, BATCH],
    );
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
      const message = deps.cipher.decryptJson<QueuedMessage>(
        "sms.message",
        row.key_id,
        row.message_enc,
      );
      const result = await deps.sms.send(message.to, message.text);
      const attempts = row.attempts + 1;
      if (result.ok) {
        sent += 1;
        await client.query("UPDATE sms_outbox SET sent_at = $2, attempts = $3 WHERE id = $1", [
          row.id,
          now,
          attempts,
        ]);
      } else if (!result.retry || attempts >= MAX_ATTEMPTS) {
        failed += 1;
        await client.query("UPDATE sms_outbox SET failed_at = $2, attempts = $3 WHERE id = $1", [
          row.id,
          now,
          attempts,
        ]);
      } else {
        const delay = RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)] ?? 60_000;
        await client.query(
          "UPDATE sms_outbox SET attempts = $2, next_attempt_at = $3 WHERE id = $1",
          [row.id, attempts, new Date(now.getTime() + delay)],
        );
      }
    }
    return { sent, failed };
  });
}
