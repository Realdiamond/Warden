// Staff accounts and console sessions. Passwords use Argon2id; session tokens are random and
// only their SHA-256 hash is stored.

import { randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { MIN_STAFF_PASSWORD_LENGTH, type StaffUser } from "@warden/shared";
import { randomToken, sha256 } from "../crypto.ts";
import { type Pool, withTransaction } from "../db/pool.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";

/** OWASP-recommended Argon2id settings: 19 MiB memory, 2 iterations, 1 lane. */
const ARGON2_OPTIONS = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const SESSION_ABSOLUTE_MS = 12 * 3_600_000;
export const SESSION_IDLE_MS = 30 * 60_000;
const LAST_SEEN_UPDATE_MS = 60_000;

let dummyHash: Promise<string> | undefined;

/** A real hash to verify against when the email is unknown, so timing does not leak it. */
function getDummyHash(): Promise<string> {
  dummyHash ??= hash(randomToken(24), ARGON2_OPTIONS);
  return dummyHash;
}

export async function createStaff(
  pool: Pool,
  input: { email: string; password: string; role: StaffUser["role"] },
  now: Date,
): Promise<StaffUser> {
  if (input.password.length < MIN_STAFF_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_STAFF_PASSWORD_LENGTH} characters`);
  }
  const id = randomUUID();
  const passwordHash = await hash(input.password, ARGON2_OPTIONS);
  return withTransaction(pool, async (client) => {
    await client.query(
      "INSERT INTO staff (id, email, password_hash, role, created_at) VALUES ($1, $2, $3, $4, $5)",
      [id, input.email.trim(), passwordHash, input.role, now],
    );
    await appendAudit(client, {
      at: now,
      actorType: "system",
      actorId: "cli",
      action: "staff.created",
      objectType: "staff",
      objectId: id,
      details: { role: input.role },
    });
    return { id, email: input.email.trim(), role: input.role };
  });
}

interface StaffRow {
  id: string;
  email: string;
  role: StaffUser["role"];
  password_hash: string;
  disabled_at: Date | null;
}

export type LoginResult = { ok: true; staff: StaffUser; token: string } | { ok: false };

export async function login(
  deps: ServiceDeps,
  email: string,
  password: string,
): Promise<LoginResult> {
  const now = deps.now();
  const { rows } = await deps.pool.query<StaffRow>(
    "SELECT id, email, role, password_hash, disabled_at FROM staff WHERE lower(email) = lower($1)",
    [email.trim()],
  );
  const row = rows[0];
  const passwordOk = await verify(row?.password_hash ?? (await getDummyHash()), password).catch(
    () => false,
  );
  if (!row || !passwordOk || row.disabled_at) return { ok: false };

  const token = randomToken(32);
  const staff: StaffUser = { id: row.id, email: row.email, role: row.role };
  await withTransaction(deps.pool, async (client) => {
    await client.query(
      `INSERT INTO staff_sessions (token_hash, staff_id, created_at, last_seen_at, expires_at)
       VALUES ($1, $2, $3, $3, $4)`,
      [sha256(token), row.id, now, new Date(now.getTime() + SESSION_ABSOLUTE_MS)],
    );
    await client.query("UPDATE staff SET last_login_at = $2 WHERE id = $1", [row.id, now]);
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: row.id,
      action: "staff.login",
      objectType: "staff",
      objectId: row.id,
    });
  });
  return { ok: true, staff, token };
}

interface SessionRow {
  staff_id: string;
  email: string;
  role: StaffUser["role"];
  disabled_at: Date | null;
  last_seen_at: Date;
  expires_at: Date;
}

export async function authenticate(deps: ServiceDeps, token: string): Promise<StaffUser | null> {
  const now = deps.now();
  const tokenHash = sha256(token);
  const { rows } = await deps.pool.query<SessionRow>(
    `SELECT s.staff_id, st.email, st.role, st.disabled_at, s.last_seen_at, s.expires_at
       FROM staff_sessions s
       JOIN staff st ON st.id = s.staff_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  );
  const row = rows[0];
  if (!row || row.disabled_at) return null;
  if (row.expires_at <= now || now.getTime() - row.last_seen_at.getTime() > SESSION_IDLE_MS) {
    await deps.pool.query("DELETE FROM staff_sessions WHERE token_hash = $1", [tokenHash]);
    return null;
  }
  if (now.getTime() - row.last_seen_at.getTime() > LAST_SEEN_UPDATE_MS) {
    await deps.pool.query("UPDATE staff_sessions SET last_seen_at = $2 WHERE token_hash = $1", [
      tokenHash,
      now,
    ]);
  }
  return { id: row.staff_id, email: row.email, role: row.role };
}

export async function logout(deps: ServiceDeps, token: string): Promise<void> {
  await deps.pool.query("DELETE FROM staff_sessions WHERE token_hash = $1", [sha256(token)]);
}
