// Trip sharing and SOS (PRD modules 8 and 9). The phone holds a control token; trusted contacts
// hold a view token in their link. Both are stored only as hashes. Locations, names, notes and
// contact numbers are encrypted, and everything is deleted two days after the session ends.

import { randomUUID } from "node:crypto";
import {
  type Contact,
  MAX_TRIP_MS,
  OVERDUE_GRACE_MS,
  SESSION_MAX_MS,
  SESSION_RETENTION_MS,
  type SessionKind,
  type SessionOutcome,
  type SessionPoint,
  type SessionReceipt,
  type SessionStart,
  type SessionState,
  type SessionView,
  viewLink,
} from "@warden/shared";
import { randomToken, safeEqual, sha256 } from "../crypto.ts";
import { type Client, withTransaction } from "../db/pool.ts";
import type { ServiceDeps } from "./deps.ts";
import { updateSessionArea } from "./responders.ts";
import { queueSms } from "./sms.ts";

interface SessionDetails {
  personName: string;
  note: string | null;
  destination: SessionStart["destination"] | null;
  contacts: Contact[];
}

interface SessionRow {
  id: string;
  kind: SessionKind;
  state: SessionState;
  duress: boolean;
  outcome: SessionOutcome | null;
  view_token_hash: Buffer;
  control_token_hash: Buffer;
  key_id: string;
  view_token_enc: Buffer;
  details_enc: Buffer;
  expected_arrival_at: Date | null;
  started_at: Date;
  ended_at: Date | null;
  expires_at: Date;
}

interface StoredPoint {
  lat: number;
  lng: number;
  accuracyM: number | null;
  battery: number | null;
}

export type SessionFailure = { ok: false; status: 400 | 404 | 409; message: string };

const TRACK_WINDOW_MS = 6 * 3_600_000;
const MAX_TRACK_POINTS = 500;

function details(deps: ServiceDeps, row: SessionRow): SessionDetails {
  return deps.cipher.decryptJson<SessionDetails>("session.details", row.key_id, row.details_enc);
}

function linkFor(deps: ServiceDeps, row: SessionRow): string | null {
  if (!deps.publicWebUrl) return null;
  const token = deps.cipher.decrypt("session.viewToken", row.key_id, row.view_token_enc);
  return viewLink(deps.publicWebUrl, row.id, token);
}

function hhmm(date: Date): string {
  return date.toLocaleTimeString("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Lagos",
  });
}

/** Message texts are short, plain and work on any phone. */
export function smsText(
  event: "sos.started" | "trip.overdue" | "duress" | "safe" | "arrived" | "extended",
  d: SessionDetails,
  link: string | null,
  extra: { minutes?: number; expectedAt?: Date } = {},
): string {
  const where = link ? ` Live location: ${link}` : "";
  switch (event) {
    case "sos.started":
      return `Warden SOS: ${d.personName} needs help now.${where} If you cannot reach them, call 112.`;
    case "trip.overdue": {
      const place = d.destination?.label ? ` at ${d.destination.label}` : "";
      const time = extra.expectedAt ? ` by ${hhmm(extra.expectedAt)}` : "";
      return `Warden: ${d.personName} has not arrived${place}${time} as planned.${where} Please try to call them.`;
    }
    case "duress":
      return `Warden URGENT: ${d.personName} may be in danger and unable to say so.${where} Call 112 if you cannot safely reach them.`;
    case "safe":
      return `Warden: ${d.personName} says they are safe now.`;
    case "arrived":
      return `Warden: ${d.personName} has arrived safely.`;
    case "extended":
      return `Warden: ${d.personName} added ${extra.minutes ?? 0} minutes to their trip.`;
  }
}

async function queueForContacts(
  client: Client,
  deps: ServiceDeps,
  row: SessionRow,
  event: Parameters<typeof smsText>[0],
  extra: Parameters<typeof smsText>[3] = {},
): Promise<number> {
  const d = details(deps, row);
  const text = smsText(event, d, linkFor(deps, row), extra);
  let queued = 0;
  for (const contact of d.contacts) {
    if (await queueSms(client, deps, { sessionId: row.id, event, to: contact.phone, text })) {
      queued += 1;
    }
  }
  return queued;
}

export async function startSession(
  deps: ServiceDeps,
  start: SessionStart,
): Promise<{ ok: true; receipt: SessionReceipt } | SessionFailure> {
  const now = deps.now();
  let expectedArrivalAt: Date | null = null;
  if (start.expectedArrivalAt) {
    expectedArrivalAt = new Date(start.expectedArrivalAt);
    const ahead = expectedArrivalAt.getTime() - now.getTime();
    if (ahead < -60_000 || ahead > MAX_TRIP_MS) {
      return {
        ok: false,
        status: 400,
        message: "The arrival time must be within the next 12 hours.",
      };
    }
  }

  const id = randomUUID();
  const viewToken = randomToken(32);
  const controlToken = randomToken(32);
  const expiresAt = new Date(now.getTime() + SESSION_MAX_MS);
  const sessionDetails: SessionDetails = {
    personName: start.personName,
    note: start.note || null,
    destination: start.destination ?? null,
    contacts: start.contacts,
  };

  await withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<SessionRow>(
      `INSERT INTO safety_sessions
         (id, kind, state, view_token_hash, control_token_hash, key_id, view_token_enc, details_enc,
          expected_arrival_at, started_at, expires_at, updated_at, share_with_responders)
       VALUES ($1, $2, 'active', $3, $4, $5, $6, $7, $8, $9, $10, $9, $11)
       RETURNING *`,
      [
        id,
        start.kind,
        sha256(viewToken),
        sha256(controlToken),
        deps.cipher.currentKeyId,
        deps.cipher.encrypt("session.viewToken", viewToken),
        deps.cipher.encryptJson("session.details", sessionDetails),
        expectedArrivalAt,
        now,
        expiresAt,
        start.kind === "sos" && start.shareWithResponders,
      ],
    );
    const row = rows[0];
    if (row && start.kind === "sos") await queueForContacts(client, deps, row, "sos.started");
  });

  return {
    ok: true,
    receipt: {
      sessionId: id,
      viewToken,
      controlToken,
      viewUrl: deps.publicWebUrl ? viewLink(deps.publicWebUrl, id, viewToken) : null,
      expiresAt: expiresAt.toISOString(),
    },
  };
}

/** Loads and locks a session for its phone; null when the id or token is wrong. */
async function lockForControl(
  client: Client,
  sessionId: string,
  controlToken: string,
): Promise<SessionRow | null> {
  const { rows } = await client.query<SessionRow>(
    "SELECT * FROM safety_sessions WHERE id = $1 FOR UPDATE",
    [sessionId],
  );
  const row = rows[0];
  if (!row || !safeEqual(row.control_token_hash, sha256(controlToken))) return null;
  return row;
}

const NOT_FOUND: SessionFailure = { ok: false, status: 404, message: "Session not found." };
const ENDED: SessionFailure = { ok: false, status: 409, message: "This session has ended." };

export async function addPoints(
  deps: ServiceDeps,
  sessionId: string,
  controlToken: string,
  points: SessionPoint[],
): Promise<{ ok: true; accepted: number; state: SessionState } | SessionFailure> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const row = await lockForControl(client, sessionId, controlToken);
    if (!row) return NOT_FOUND;
    if (row.state === "ended") return ENDED;

    // Points recorded while offline arrive late; anything outside the session is dropped.
    const earliest = row.started_at.getTime() - 5 * 60_000;
    const latest = now.getTime() + 60_000;
    let accepted = 0;
    let newest = 0;
    let newestPoint: SessionPoint | null = null;
    for (const point of points) {
      const at = new Date(point.at).getTime();
      if (at < earliest || at > latest) continue;
      const stored: StoredPoint = {
        lat: point.lat,
        lng: point.lng,
        accuracyM: point.accuracyM ?? null,
        battery: point.battery ?? null,
      };
      await client.query(
        `INSERT INTO session_points (session_id, recorded_at, key_id, point_enc, created_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.id,
          new Date(Math.min(at, now.getTime())),
          deps.cipher.currentKeyId,
          deps.cipher.encryptJson("session.point", stored),
          now,
        ],
      );
      accepted += 1;
      if (at >= newest) {
        newest = Math.min(at, now.getTime());
        newestPoint = point;
      }
    }
    if (accepted > 0) {
      await client.query(
        `UPDATE safety_sessions
            SET last_point_at = GREATEST(COALESCE(last_point_at, $2), $2), updated_at = $3
          WHERE id = $1`,
        [row.id, new Date(newest), now],
      );
      if (newestPoint) await updateSessionArea(client, row.id, newestPoint);
    }
    return { ok: true, accepted, state: row.state };
  });
}

export async function extendSession(
  deps: ServiceDeps,
  sessionId: string,
  controlToken: string,
  minutes: number,
): Promise<{ ok: true; expectedArrivalAt: string } | SessionFailure> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const row = await lockForControl(client, sessionId, controlToken);
    if (!row) return NOT_FOUND;
    if (row.state === "ended") return ENDED;
    if (row.kind !== "trip" || !row.expected_arrival_at) {
      return { ok: false, status: 409, message: "Only trips have an arrival time." };
    }
    const base = Math.max(row.expected_arrival_at.getTime(), now.getTime());
    const next = new Date(Math.min(base + minutes * 60_000, row.expires_at.getTime()));
    await client.query(
      `UPDATE safety_sessions
          SET expected_arrival_at = $2, state = CASE WHEN state = 'overdue' THEN 'active' ELSE state END,
              updated_at = $3
        WHERE id = $1`,
      [row.id, next, now],
    );
    // Contacts already told the trip was late hear that it is back on track.
    if (row.state === "overdue") await queueForContacts(client, deps, row, "extended", { minutes });
    return { ok: true, expectedArrivalAt: next.toISOString() };
  });
}

export async function endSession(
  deps: ServiceDeps,
  sessionId: string,
  controlToken: string,
  end: { outcome: "arrived" | "safe" | "cancelled"; duress: boolean },
): Promise<{ ok: true } | SessionFailure> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const row = await lockForControl(client, sessionId, controlToken);
    if (!row) return NOT_FOUND;
    if (row.state === "ended") return ENDED;

    if (end.duress) {
      // The phone shows the session as stopped; the server keeps it open and raises the alarm.
      await client.query(
        "UPDATE safety_sessions SET duress = true, updated_at = $2 WHERE id = $1",
        [row.id, now],
      );
      if (!row.duress) await queueForContacts(client, deps, row, "duress");
      return { ok: true };
    }

    await client.query(
      `UPDATE safety_sessions
          SET state = 'ended', outcome = $2, ended_at = $3, updated_at = $3
        WHERE id = $1`,
      [row.id, end.outcome, now],
    );
    // Tell contacts who were alarmed that it is over.
    if (row.kind === "sos" || row.state === "overdue" || row.duress) {
      await queueForContacts(client, deps, row, end.outcome === "arrived" ? "arrived" : "safe");
    }
    return { ok: true };
  });
}

export async function viewSession(
  deps: ServiceDeps,
  sessionId: string,
  viewToken: string,
): Promise<SessionView | null> {
  const now = deps.now();
  const { rows } = await deps.pool.query<SessionRow>(
    "SELECT * FROM safety_sessions WHERE id = $1",
    [sessionId],
  );
  const row = rows[0];
  if (!row || !safeEqual(row.view_token_hash, sha256(viewToken))) return null;

  const points = await deps.pool.query<{ recorded_at: Date; key_id: string; point_enc: Buffer }>(
    `SELECT recorded_at, key_id, point_enc FROM session_points
      WHERE session_id = $1 AND recorded_at >= $2
      ORDER BY recorded_at, id`,
    [row.id, new Date(now.getTime() - TRACK_WINDOW_MS)],
  );
  const decoded = points.rows.map((p) => ({
    at: p.recorded_at,
    ...deps.cipher.decryptJson<StoredPoint>("session.point", p.key_id, p.point_enc),
  }));
  const step = Math.max(1, Math.ceil(decoded.length / MAX_TRACK_POINTS));
  const track = decoded
    .filter((_, i) => i % step === 0 || i === decoded.length - 1)
    .map((p) => [p.lng, p.lat] as [number, number]);
  const last = decoded.at(-1);

  const d = details(deps, row);
  return {
    kind: row.kind,
    state: row.state,
    alarm: row.state !== "ended" && (row.kind === "sos" || row.state === "overdue" || row.duress),
    duress: row.duress,
    personName: d.personName,
    note: d.note,
    destination: d.destination ?? null,
    expectedArrivalAt: row.expected_arrival_at?.toISOString() ?? null,
    startedAt: row.started_at.toISOString(),
    endedAt: row.ended_at?.toISOString() ?? null,
    outcome: row.outcome,
    lastPoint: last
      ? {
          lat: last.lat,
          lng: last.lng,
          accuracyM: last.accuracyM,
          at: last.at.toISOString(),
          battery: last.battery,
        }
      : null,
    track,
  };
}

/** Marks late trips overdue (and tells contacts), stops old sessions, deletes expired data. */
export async function runSessionHousekeeping(
  deps: ServiceDeps,
): Promise<{ overdue: number; expired: number; deleted: number }> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const overdue = await client.query<SessionRow>(
      `UPDATE safety_sessions
          SET state = 'overdue', updated_at = $1
        WHERE state = 'active' AND kind = 'trip' AND NOT duress
          AND expected_arrival_at < $2
        RETURNING *`,
      [now, new Date(now.getTime() - OVERDUE_GRACE_MS)],
    );
    for (const row of overdue.rows) {
      await queueForContacts(client, deps, row, "trip.overdue", {
        expectedAt: row.expected_arrival_at ?? undefined,
      });
    }

    const expired = await client.query(
      `UPDATE safety_sessions
          SET state = 'ended', outcome = 'expired', ended_at = $1, updated_at = $1
        WHERE state <> 'ended' AND expires_at < $1`,
      [now],
    );
    const deleted = await client.query(
      "DELETE FROM safety_sessions WHERE state = 'ended' AND ended_at < $1",
      [new Date(now.getTime() - SESSION_RETENTION_MS)],
    );
    return {
      overdue: overdue.rowCount ?? 0,
      expired: expired.rowCount ?? 0,
      deleted: deleted.rowCount ?? 0,
    };
  });
}
