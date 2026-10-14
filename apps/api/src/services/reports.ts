// Citizen reports: validation beyond the schema, idempotency, merging into incidents and the
// publication rules. Exact location and text are encrypted before they reach the database.

import { randomUUID } from "node:crypto";
import {
  ACTIVE_STATES,
  ACTIVE_TTL_MS,
  decidePublication,
  type IncidentState,
  MERGE_WINDOW_MS,
  type ParsedReportSubmission,
  type ReportPublicStatus,
  type ReportReceipt,
  type ReportStatus,
  requireCategory,
  stateAfterMerge,
} from "@warden/shared";
import { cellCenter, cellsFor, isInNigeria, nearbyCells, publicCellFor } from "@warden/shared/geo";
import { randomToken, safeEqual, sha256 } from "../crypto.ts";
import { type Client, withTransaction } from "../db/pool.ts";
import { loadIncidentForAlert, recordIncidentAlert } from "./alerts.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";

/** Reports may describe something that happened up to a week ago, never in the future. */
const MAX_REPORT_AGE_MS = 7 * 86_400_000;
const CLOCK_SKEW_MS = 5 * 60_000;

export type ReportChannel = "app" | "lite" | "ussd" | "demo";

/**
 * USSD reports carry only a local government area, not a point: they are always held for a
 * moderator, and if published are shown at the coarsest area (H3 resolution 7, about 5 km²).
 */
const USSD_DECISION = {
  state: "held",
  publishDelayMs: 0,
  reason: "USSD reports are approximate and need a moderator",
} as const;

export interface NewReport {
  submission: ParsedReportSubmission;
  /** Random id the app generates once per install; never stored as-is. */
  installId: string;
  idempotencyKey: string;
  channel: ReportChannel;
}

export type CreateReportResult =
  | { ok: true; receipt: ReportReceipt; replayed: boolean }
  | { ok: false; status: 422; message: string };

interface CandidateRow {
  id: string;
  state: IncidentState;
  independent_reports: number;
  publish_after: Date | null;
}

/** Turns bytes of a keyed hash into a signed 64-bit advisory lock id. */
function lockId(hash: Buffer): string {
  return hash.readBigInt64BE(0).toString();
}

export async function createReport(
  deps: ServiceDeps,
  input: NewReport,
): Promise<CreateReportResult> {
  const { submission, installId, idempotencyKey, channel } = input;
  const { lat, lng, accuracyM } = submission.location;
  const now = deps.now();

  if (!isInNigeria(lat, lng)) {
    return { ok: false, status: 422, message: "The location must be in Nigeria." };
  }

  let occurredAt: Date | null = null;
  if (submission.occurredAt) {
    occurredAt = new Date(submission.occurredAt);
    const age = now.getTime() - occurredAt.getTime();
    if (age < -CLOCK_SKEW_MS || age > MAX_REPORT_AGE_MS) {
      return { ok: false, status: 422, message: "The time must be within the last 7 days." };
    }
  }

  const category = requireCategory(submission.categoryId);
  const cells = cellsFor(lat, lng);
  const keyHash = deps.hasher.hmac("idempotency", installId, idempotencyKey);

  return withTransaction(deps.pool, async (client) => {
    // One request per idempotency key at a time; a retry waits and then replays.
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockId(keyHash)]);
    const replay = await client.query<{ key_id: string; response_enc: Buffer }>(
      "SELECT key_id, response_enc FROM idempotency_keys WHERE key_hash = $1",
      [keyHash],
    );
    const stored = replay.rows[0];
    if (stored) {
      const receipt = deps.cipher.decryptJson<ReportReceipt>(
        "idempotency.response",
        stored.key_id,
        stored.response_enc,
      );
      return { ok: true, receipt, replayed: true };
    }

    // Serialise reports of one category in one neighbourhood so two first reports of the
    // same event cannot create two incidents.
    await client.query("SELECT pg_advisory_xact_lock($1::bigint)", [
      lockId(deps.hasher.hmac("merge-area", category.id, cells.r7)),
    ]);

    const incidentId = await mergeOrCreateIncident(deps, client, {
      categoryId: category.id,
      installId,
      cells,
      now,
      approximate: channel === "ussd",
    });

    const reportId = randomUUID();
    const statusToken = randomToken(32);
    await client.query(
      `INSERT INTO reports
         (id, incident_id, channel, category_id, key_id, location_enc, description_enc,
          cell_r7, cell_r8, cell_r9, proximity, device_tag, status_token_hash, occurred_at, received_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [
        reportId,
        incidentId,
        channel,
        category.id,
        deps.cipher.currentKeyId,
        deps.cipher.encryptJson("report.location", { lat, lng, accuracyM: accuracyM ?? null }),
        submission.description
          ? deps.cipher.encrypt("report.description", submission.description)
          : null,
        cells.r7,
        cells.r8,
        cells.r9,
        submission.proximity,
        deps.hasher.hmac("device-incident", installId, incidentId),
        sha256(statusToken),
        occurredAt,
        now,
      ],
    );

    const receipt: ReportReceipt = { reportId, statusToken, receivedAt: now.toISOString() };
    await client.query(
      "INSERT INTO idempotency_keys (key_hash, key_id, response_enc, created_at) VALUES ($1, $2, $3, $4)",
      [
        keyHash,
        deps.cipher.currentKeyId,
        deps.cipher.encryptJson("idempotency.response", receipt),
        now,
      ],
    );
    return { ok: true, receipt, replayed: false };
  });
}

async function mergeOrCreateIncident(
  deps: ServiceDeps,
  client: Client,
  args: {
    categoryId: string;
    installId: string;
    cells: ReturnType<typeof cellsFor>;
    now: Date;
    approximate: boolean;
  },
): Promise<string> {
  const { categoryId, installId, cells, now, approximate } = args;
  const category = requireCategory(categoryId);
  const activeUntil = new Date(now.getTime() + ACTIVE_TTL_MS[category.severity]);

  const candidates = await client.query<CandidateRow>(
    `SELECT id, state, independent_reports, publish_after
       FROM incidents
      WHERE category_id = $1
        AND match_cell = ANY($2::text[])
        AND state = ANY($3::text[])
        AND last_report_at >= $4
      ORDER BY last_report_at DESC
      LIMIT 1
      FOR UPDATE`,
    [categoryId, nearbyCells(cells.r9), ACTIVE_STATES, new Date(now.getTime() - MERGE_WINDOW_MS)],
  );
  const candidate = candidates.rows[0];

  if (candidate) {
    const tag = deps.hasher.hmac("device-incident", installId, candidate.id);
    const repeat = await client.query(
      "SELECT 1 FROM reports WHERE incident_id = $1 AND device_tag = $2 LIMIT 1",
      [candidate.id, tag],
    );
    const independent = candidate.independent_reports + (repeat.rowCount === 0 ? 1 : 0);
    const decision = approximate
      ? USSD_DECISION
      : decidePublication(
          { category, independentReports: independent, reporterTrust: "low" },
          deps.random,
        );
    const nextState = stateAfterMerge(candidate.state, decision);
    const released = candidate.state === "held" && nextState === "unconfirmed";
    const publishAfter = released
      ? new Date(now.getTime() + decision.publishDelayMs)
      : candidate.publish_after;

    await client.query(
      `UPDATE incidents
          SET report_count = report_count + 1,
              independent_reports = $2,
              state = $3,
              publish_after = $4,
              last_report_at = $5,
              active_until = $6,
              updated_at = $5
        WHERE id = $1`,
      [candidate.id, independent, nextState, publishAfter, now, activeUntil],
    );
    if (released && publishAfter) {
      const incident = await loadIncidentForAlert(client, candidate.id);
      if (incident) await recordIncidentAlert(client, incident, "new", publishAfter, now);
      await appendAudit(client, {
        at: now,
        actorType: "system",
        actorId: "publication-rules",
        action: "incident.released",
        objectType: "incident",
        objectId: candidate.id,
        reason: decision.reason,
        details: { from: candidate.state, to: nextState, independentReports: independent },
      });
    }
    return candidate.id;
  }

  const decision = approximate
    ? USSD_DECISION
    : decidePublication({ category, independentReports: 1, reporterTrust: "low" }, deps.random);
  const id = randomUUID();
  const publicCell = approximate ? cells.r7 : publicCellFor(cells, category.severity);
  const center = cellCenter(publicCell);
  const publishAfter =
    decision.state === "unconfirmed" ? new Date(now.getTime() + decision.publishDelayMs) : null;

  await client.query(
    `INSERT INTO incidents
       (id, category_id, severity, handling, state, public_cell, public_point, match_cell,
        report_count, independent_reports, first_reported_at, last_report_at, publish_after,
        active_until, source, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9,
             1, 1, $10, $10, $11, $12, 'citizen', $10, $10)`,
    [
      id,
      category.id,
      category.severity,
      category.handling,
      decision.state,
      publicCell,
      center.lng,
      center.lat,
      cells.r9,
      now,
      publishAfter,
      activeUntil,
    ],
  );
  if (publishAfter) {
    const incident = await loadIncidentForAlert(client, id);
    if (incident) await recordIncidentAlert(client, incident, "new", publishAfter, now);
  }
  return id;
}

interface StatusRow {
  status_token_hash: Buffer;
  state: IncidentState;
  publish_after: Date | null;
  report_count: number;
  updated_at: Date;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Returns null for unknown reports and wrong tokens alike, so ids cannot be probed. */
export async function getReportStatus(
  deps: ServiceDeps,
  reportId: string,
  statusToken: string,
): Promise<ReportStatus | null> {
  if (!UUID_PATTERN.test(reportId)) return null;
  const { rows } = await deps.pool.query<StatusRow>(
    `SELECT r.status_token_hash, i.state, i.publish_after, i.report_count, i.updated_at
       FROM reports r
       JOIN incidents i ON i.id = r.incident_id
      WHERE r.id = $1`,
    [reportId],
  );
  const row = rows[0];
  if (!row || !safeEqual(row.status_token_hash, sha256(statusToken))) return null;

  const now = deps.now();
  const published = row.publish_after !== null && row.publish_after <= now;
  const statusByState: Record<IncidentState, ReportPublicStatus> = {
    held: "in_review",
    unconfirmed: published ? "on_map" : "in_review",
    disputed: published ? "on_map" : "in_review",
    verified: "confirmed",
    resolved: "closed",
    removed: "not_published",
    merged: "on_map",
  };
  return {
    reportId,
    status: statusByState[row.state],
    reportCount: row.report_count,
    updatedAt: row.updated_at.toISOString(),
  };
}
