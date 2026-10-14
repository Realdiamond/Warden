// Re-encrypts stored Restricted data with the current field key, so an old key can be retired
// (for example after it may have leaked). Each row records the key id it was locked with; rows
// on any other id are decrypted with their old key and written back with the current one.

import type { Cipher, Purpose } from "../crypto.ts";
import { type Pool, withTransaction } from "../db/pool.ts";
import { appendAudit } from "./audit.ts";

interface EncryptedTable {
  table: string;
  primaryKey: string;
  columns: ReadonlyArray<{ name: string; purpose: Purpose }>;
}

/** Every table with encrypted columns. Names are fixed here, never taken from input. */
export const ENCRYPTED_TABLES: readonly EncryptedTable[] = [
  {
    table: "reports",
    primaryKey: "id",
    columns: [
      { name: "location_enc", purpose: "report.location" },
      { name: "description_enc", purpose: "report.description" },
    ],
  },
  {
    table: "idempotency_keys",
    primaryKey: "key_hash",
    columns: [{ name: "response_enc", purpose: "idempotency.response" }],
  },
  {
    table: "safety_sessions",
    primaryKey: "id",
    columns: [
      { name: "view_token_enc", purpose: "session.viewToken" },
      { name: "details_enc", purpose: "session.details" },
    ],
  },
  {
    table: "session_points",
    primaryKey: "id",
    columns: [{ name: "point_enc", purpose: "session.point" }],
  },
  {
    table: "sms_outbox",
    primaryKey: "id",
    columns: [{ name: "message_enc", purpose: "sms.message" }],
  },
  {
    table: "community_posts",
    primaryKey: "id",
    columns: [{ name: "body_enc", purpose: "community.body" }],
  },
  {
    table: "report_media",
    primaryKey: "id",
    columns: [{ name: "data_enc", purpose: "report.media" }],
  },
  {
    table: "session_audio",
    primaryKey: "id",
    columns: [{ name: "data_enc", purpose: "session.audio" }],
  },
];

/** Rows per table still locked with a key other than the current one. */
export async function countOldKeyRows(pool: Pool, currentKeyId: string) {
  const counts: Record<string, number> = {};
  for (const { table } of ENCRYPTED_TABLES) {
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM ${table} WHERE key_id <> $1`,
      [currentKeyId],
    );
    counts[table] = Number(rows[0]?.n ?? 0);
  }
  return counts;
}

/**
 * Re-encrypts every row on an old key, in small transactions so the service keeps running.
 * Returns how many rows each table had re-encrypted. Throws if a row uses a key the cipher does
 * not have (it must be added to WARDEN_OLD_FIELD_KEYS first); each batch is all or nothing.
 */
export async function reencryptOldKeyRows(
  deps: { pool: Pool; cipher: Cipher; now: () => Date },
  options: { batchSize?: number } = {},
): Promise<Record<string, number>> {
  const batchSize = options.batchSize ?? 200;
  const current = deps.cipher.currentKeyId;
  const done: Record<string, number> = {};
  for (const spec of ENCRYPTED_TABLES) {
    const cols = spec.columns.map((c) => c.name);
    done[spec.table] = 0;
    for (;;) {
      const moved = await withTransaction(deps.pool, async (client) => {
        const { rows } = await client.query<Record<string, unknown> & { key_id: string }>(
          `SELECT ${spec.primaryKey} AS pk, key_id, ${cols.join(", ")} FROM ${spec.table}
            WHERE key_id <> $1
            ORDER BY ${spec.primaryKey}
            LIMIT $2
            FOR UPDATE SKIP LOCKED`,
          [current, batchSize],
        );
        const sets = cols.map((name, i) => `${name} = $${i + 2}`).join(", ");
        for (const row of rows) {
          const values = spec.columns.map(({ name, purpose }) => {
            const old = row[name] as Buffer | null;
            if (old === null) return null;
            return deps.cipher.encrypt(purpose, deps.cipher.decrypt(purpose, row.key_id, old));
          });
          await client.query(
            `UPDATE ${spec.table} SET key_id = $1, ${sets}
              WHERE ${spec.primaryKey} = $${cols.length + 2}`,
            [current, ...values, row.pk],
          );
        }
        return rows.length;
      });
      done[spec.table] = (done[spec.table] ?? 0) + moved;
      if (moved < batchSize) break;
    }
  }

  await withTransaction(deps.pool, (client) =>
    appendAudit(client, {
      at: deps.now(),
      actorType: "system",
      actorId: "rotate-field-key",
      action: "field_key.reencrypt",
      objectType: "field_key",
      objectId: current,
      details: { rows: done },
    }),
  );
  return done;
}
