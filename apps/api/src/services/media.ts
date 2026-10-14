// Media (M8): voice notes, photos and videos on reports, and SOS audio clips for trusted
// contacts. All of it is Restricted: encrypted at rest, never public, and every read by staff
// is audited. Bytes are stored as base64 inside the field cipher so key rotation needs no
// special case.

import { randomUUID } from "node:crypto";
import {
  MAX_MEDIA_PER_REPORT,
  MEDIA_MAX_BYTES,
  type MediaKind,
  mediaKindOf,
  type ReportMediaInfo,
  type SessionClip,
  SOS_AUDIO_MAX_BYTES,
  type StaffUser,
} from "@warden/shared";
import { safeEqual, sha256 } from "../crypto.ts";
import { type Client, withTransaction } from "../db/pool.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";

/** At most two hours of 30-second clips per SOS. */
const MAX_CLIPS_PER_SESSION = 240;

export type MediaFailure = { ok: false; status: 400 | 404 | 409 | 413 | 415; message: string };

/** Checks the first bytes, so a file cannot pretend to be a different type. */
export function looksLike(kind: MediaKind, contentType: string, data: Buffer): boolean {
  const type = contentType.split(";")[0]?.trim().toLowerCase();
  if (kind === "photo") return data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if (type === "audio/webm") return data.readUInt32BE(0) === 0x1a45dfa3;
  if (type === "audio/ogg") return data.subarray(0, 4).toString("latin1") === "OggS";
  if (type === "audio/aac") return data[0] === 0xff && (data[1] ?? 0) >> 4 === 0xf;
  // MP4 family (audio/mp4, audio/m4a, video/mp4): an "ftyp" box near the start.
  return data.subarray(4, 8).toString("latin1") === "ftyp";
}

function check(
  contentType: string | undefined,
  data: Buffer,
  maxBytes: (kind: MediaKind) => number,
  allowed: (kind: MediaKind) => boolean,
): { ok: true; kind: MediaKind; type: string } | MediaFailure {
  const kind = mediaKindOf(contentType);
  if (!kind || !contentType || !allowed(kind)) {
    return { ok: false, status: 415, message: "This kind of file cannot be sent." };
  }
  if (data.length === 0) return { ok: false, status: 400, message: "The file is empty." };
  if (data.length > maxBytes(kind)) {
    return { ok: false, status: 413, message: "The file is too large." };
  }
  if (data.length < 8 || !looksLike(kind, contentType, data)) {
    return { ok: false, status: 415, message: "The file does not match its type." };
  }
  return { ok: true, kind, type: contentType.split(";")[0]?.trim().toLowerCase() ?? "" };
}

/** Adds a voice note, photo or video to a report. The report's status token proves ownership. */
export async function attachReportMedia(
  deps: ServiceDeps,
  input: { reportId: string; statusToken: string; contentType: string | undefined; data: Buffer },
): Promise<{ ok: true; id: string } | MediaFailure> {
  const checked = check(
    input.contentType,
    input.data,
    (k) => MEDIA_MAX_BYTES[k],
    () => true,
  );
  if (!checked.ok) return checked;
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<{ status_token_hash: Buffer; count: number }>(
      `SELECT r.status_token_hash,
              (SELECT count(*)::int FROM report_media m WHERE m.report_id = r.id) AS count
         FROM reports r WHERE r.id = $1 FOR UPDATE`,
      [input.reportId],
    );
    const row = rows[0];
    if (!row || !safeEqual(row.status_token_hash, sha256(input.statusToken))) {
      return { ok: false, status: 404, message: "Report not found." };
    }
    if (row.count >= MAX_MEDIA_PER_REPORT) {
      return { ok: false, status: 409, message: "This report already has the most files allowed." };
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO report_media (id, report_id, kind, content_type, bytes, key_id, data_enc, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.reportId,
        checked.kind,
        checked.type,
        input.data.length,
        deps.cipher.currentKeyId,
        deps.cipher.encrypt("report.media", input.data.toString("base64")),
        now,
      ],
    );
    return { ok: true, id };
  });
}

/** Attachment lists for reports, without the data. */
export async function mediaForReports(
  client: Client,
  reportIds: string[],
): Promise<Map<string, ReportMediaInfo[]>> {
  const result = new Map<string, ReportMediaInfo[]>();
  if (reportIds.length === 0) return result;
  const { rows } = await client.query<{
    id: string;
    report_id: string;
    kind: MediaKind;
    content_type: string;
    bytes: number;
    created_at: Date;
  }>(
    `SELECT id, report_id, kind, content_type, bytes, created_at FROM report_media
      WHERE report_id = ANY($1::uuid[]) ORDER BY created_at`,
    [reportIds],
  );
  for (const row of rows) {
    const list = result.get(row.report_id) ?? [];
    list.push({
      id: row.id,
      kind: row.kind,
      contentType: row.content_type,
      bytes: row.bytes,
      createdAt: row.created_at.toISOString(),
    });
    result.set(row.report_id, list);
  }
  return result;
}

/**
 * One attachment for staff, audited. `incidentFilter` lets responder routes limit reads to
 * incidents they can see.
 */
export async function readReportMedia(
  deps: ServiceDeps,
  staff: StaffUser,
  mediaId: string,
  incidentId: string | null = null,
): Promise<{ contentType: string; data: Buffer } | null> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<{
      content_type: string;
      key_id: string;
      data_enc: Buffer;
      incident_id: string;
    }>(
      `SELECT m.content_type, m.key_id, m.data_enc, r.incident_id
         FROM report_media m JOIN reports r ON r.id = m.report_id
        WHERE m.id = $1`,
      [mediaId],
    );
    const row = rows[0];
    if (!row || (incidentId !== null && row.incident_id !== incidentId)) return null;
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "report_media.read",
      objectType: "report_media",
      objectId: mediaId,
      details: { incidentId: row.incident_id },
    });
    const base64 = deps.cipher.decrypt("report.media", row.key_id, row.data_enc);
    return { contentType: row.content_type, data: Buffer.from(base64, "base64") };
  });
}

/** An SOS audio clip from the person's phone. Only for an SOS that is still on. */
export async function addSessionClip(
  deps: ServiceDeps,
  input: {
    sessionId: string;
    controlToken: string;
    contentType: string | undefined;
    data: Buffer;
    recordedAt: Date;
  },
): Promise<{ ok: true; id: string } | MediaFailure> {
  const checked = check(
    input.contentType,
    input.data,
    () => SOS_AUDIO_MAX_BYTES,
    (k) => k === "audio",
  );
  if (!checked.ok) return checked;
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<{
      control_token_hash: Buffer;
      kind: string;
      state: string;
      clips: number;
    }>(
      `SELECT s.control_token_hash, s.kind, s.state,
              (SELECT count(*)::int FROM session_audio a WHERE a.session_id = s.id) AS clips
         FROM safety_sessions s WHERE s.id = $1 FOR UPDATE`,
      [input.sessionId],
    );
    const row = rows[0];
    if (!row || !safeEqual(row.control_token_hash, sha256(input.controlToken))) {
      return { ok: false, status: 404, message: "Not found." };
    }
    if (row.kind !== "sos" || row.state === "ended") {
      return { ok: false, status: 409, message: "Audio is only kept during an SOS." };
    }
    if (row.clips >= MAX_CLIPS_PER_SESSION) {
      return { ok: false, status: 409, message: "No more audio can be added to this SOS." };
    }
    const recordedAt =
      Math.abs(input.recordedAt.getTime() - now.getTime()) < 6 * 3_600_000 ? input.recordedAt : now;
    const id = randomUUID();
    await client.query(
      `INSERT INTO session_audio (id, session_id, content_type, bytes, key_id, data_enc, recorded_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        id,
        input.sessionId,
        checked.type,
        input.data.length,
        deps.cipher.currentKeyId,
        deps.cipher.encrypt("session.audio", input.data.toString("base64")),
        recordedAt,
        now,
      ],
    );
    return { ok: true, id };
  });
}

async function viewerSession(deps: ServiceDeps, sessionId: string, viewToken: string) {
  const { rows } = await deps.pool.query<{ view_token_hash: Buffer }>(
    "SELECT view_token_hash FROM safety_sessions WHERE id = $1",
    [sessionId],
  );
  const row = rows[0];
  return !!row && safeEqual(row.view_token_hash, sha256(viewToken));
}

/** Clips for the contacts' live page, newest first. */
export async function listSessionClips(
  deps: ServiceDeps,
  sessionId: string,
  viewToken: string,
): Promise<SessionClip[] | null> {
  if (!(await viewerSession(deps, sessionId, viewToken))) return null;
  const { rows } = await deps.pool.query<{ id: string; recorded_at: Date; bytes: number }>(
    `SELECT id, recorded_at, bytes FROM session_audio WHERE session_id = $1
      ORDER BY recorded_at DESC LIMIT 50`,
    [sessionId],
  );
  return rows.map((r) => ({ id: r.id, recordedAt: r.recorded_at.toISOString(), bytes: r.bytes }));
}

export async function readSessionClip(
  deps: ServiceDeps,
  sessionId: string,
  viewToken: string,
  clipId: string,
): Promise<{ contentType: string; data: Buffer } | null> {
  if (!(await viewerSession(deps, sessionId, viewToken))) return null;
  const { rows } = await deps.pool.query<{
    content_type: string;
    key_id: string;
    data_enc: Buffer;
  }>("SELECT content_type, key_id, data_enc FROM session_audio WHERE id = $1 AND session_id = $2", [
    clipId,
    sessionId,
  ]);
  const row = rows[0];
  if (!row) return null;
  const base64 = deps.cipher.decrypt("session.audio", row.key_id, row.data_enc);
  return { contentType: row.content_type, data: Buffer.from(base64, "base64") };
}
