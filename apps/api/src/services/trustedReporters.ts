// Trusted reporters (M6): people Warden has checked, such as community leaders or partner staff,
// get a code to enter in the app. Their high-severity reports can go on the map without waiting
// for a second report. Critical reports still need a second source or a moderator.
// Only a keyed hash of each code is stored, and a report records only that it was trusted.

import { randomBytes, randomUUID } from "node:crypto";
import { type Pool, withTransaction } from "../db/pool.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";

/** No 0/O or 1/I, so codes read out over the phone are typed right. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** 20 characters (100 bits): long enough not to be guessed, short enough to type. */
export function newReporterCode(): string {
  const chars = [...randomBytes(20)].map((b) => CODE_ALPHABET[b % 32]).join("");
  return chars.match(/.{5}/g)?.join("-") ?? chars;
}

export function normaliseReporterCode(code: string): string {
  return code.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function codeHash(deps: Pick<ServiceDeps, "hasher">, code: string): Buffer {
  return deps.hasher.hmac("trusted-reporter", normaliseReporterCode(code));
}

export async function createTrustedReporter(
  deps: Pick<ServiceDeps, "hasher" | "now"> & { pool: Pool },
  label: string,
  createdBy: string,
): Promise<{ id: string; code: string }> {
  const id = randomUUID();
  const code = newReporterCode();
  const now = deps.now();
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO trusted_reporters (id, label, code_hash, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, label, codeHash(deps, code), createdBy, now],
    );
    await appendAudit(client, {
      at: now,
      actorType: "system",
      actorId: createdBy,
      action: "trusted_reporter.create",
      objectType: "trusted_reporter",
      objectId: id,
      details: { label },
    });
  });
  return { id, code };
}

export async function revokeTrustedReporter(
  deps: Pick<ServiceDeps, "now"> & { pool: Pool },
  id: string,
  revokedBy: string,
  reason: string,
): Promise<boolean> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rowCount } = await client.query(
      "UPDATE trusted_reporters SET revoked_at = $2 WHERE id = $1 AND revoked_at IS NULL",
      [id, now],
    );
    if (!rowCount) return false;
    await appendAudit(client, {
      at: now,
      actorType: "system",
      actorId: revokedBy,
      action: "trusted_reporter.revoke",
      objectType: "trusted_reporter",
      objectId: id,
      reason,
    });
    return true;
  });
}

/** True for a code that exists and has not been revoked. */
export async function isTrustedReporterCode(deps: ServiceDeps, code: string): Promise<boolean> {
  if (normaliseReporterCode(code).length < 16) return false;
  const { rowCount } = await deps.pool.query(
    "SELECT 1 FROM trusted_reporters WHERE code_hash = $1 AND revoked_at IS NULL",
    [codeHash(deps, code)],
  );
  return (rowCount ?? 0) > 0;
}
