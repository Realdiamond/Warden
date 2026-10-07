// Public map queries, the moderation queue and moderator actions, and automatic expiry.

import {
  applyAction,
  type Category,
  getCategory,
  type IncidentDetail,
  type IncidentState,
  type MapQuery,
  MODERATION_ACTIONS,
  type ModerationDecision,
  type ModeratorReport,
  type ProximityBand,
  PUBLIC_STATES,
  type PublicIncident,
  publicLabel,
  type QueueItem,
  REVIEW_SLA_MS,
  type ResponderStatus,
  type Severity,
  type StaffUser,
  TIME_WINDOW_MS,
  UPDATE_TEXT,
  type UpdateKind,
} from "@warden/shared";
import { cellBoundary, cellCenter } from "@warden/shared/geo";
import { type Client, withTransaction } from "../db/pool.ts";
import { alertForTransition, isActiveLive, loadIncidentForAlert } from "./alerts.ts";
import { appendAudit } from "./audit.ts";
import { floorToMinute, type ServiceDeps } from "./deps.ts";

const MAP_LIMIT = 500;
const QUEUE_LIMIT = 200;

const SEVERITY_ORDER_SQL = "CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END";

interface IncidentRow {
  id: string;
  category_id: string;
  severity: Severity;
  state: IncidentState;
  public_cell: string;
  report_count: number;
  independent_reports: number;
  first_reported_at: Date;
  last_report_at: Date;
  publish_after: Date | null;
  active_until: Date;
  confirmations: number;
  over_votes: number;
  false_votes: number;
}

const INCIDENT_COLUMNS = `id, category_id, severity, state, public_cell, report_count,
  independent_reports, first_reported_at, last_report_at, publish_after, active_until,
  confirmations, over_votes, false_votes`;

export async function mapIncidents(deps: ServiceDeps, query: MapQuery): Promise<PublicIncident[]> {
  const now = deps.now();
  const since = new Date(now.getTime() - TIME_WINDOW_MS[query.window]);
  const { minLng, minLat, maxLng, maxLat } = query.bbox;
  const params: unknown[] = [PUBLIC_STATES, now, since, minLng, minLat, maxLng, maxLat];
  let categoryFilter = "";
  if (query.categories && query.categories.length > 0) {
    params.push(query.categories);
    categoryFilter = `AND category_id = ANY($${params.length}::text[])`;
  }
  const { rows } = await deps.pool.query<IncidentRow & LatestUpdateColumns>(
    `SELECT ${INCIDENT_COLUMNS}, lu.*
       FROM incidents
       LEFT JOIN LATERAL (${LATEST_UPDATE_SQL}) lu ON true
      WHERE handling = 'public'
        AND state = ANY($1::text[])
        AND publish_after IS NOT NULL
        AND publish_after <= $2
        AND last_report_at >= $3
        AND public_point && ST_MakeEnvelope($4, $5, $6, $7, 4326)
        ${categoryFilter}
      ORDER BY ${SEVERITY_ORDER_SQL}, last_report_at DESC
      LIMIT ${MAP_LIMIT}`,
    params,
  );

  return rows.flatMap((row): PublicIncident[] => {
    const label = publicLabel(row.state, row.independent_reports + row.confirmations);
    if (!label) return [];
    return [
      {
        id: row.id,
        categoryId: row.category_id as PublicIncident["categoryId"],
        severity: row.severity,
        label,
        reportCount: row.report_count,
        firstReportedAt: floorToMinute(row.first_reported_at),
        lastReportAt: floorToMinute(row.last_report_at),
        active: row.state !== "resolved" && row.active_until > now,
        cell: row.public_cell,
        center: cellCenter(row.public_cell),
        boundary: cellBoundary(row.public_cell),
        responder: responderStatusOf(row),
      },
    ];
  });
}

/** The newest responder update for the incident in the outer query. */
export const LATEST_UPDATE_SQL = `
  SELECT u.kind AS update_kind, u.public_text AS update_text, u.created_at AS update_at,
         o.name AS update_org
    FROM incident_updates u JOIN organisations o ON o.id = u.organisation_id
   WHERE u.incident_id = incidents.id
   ORDER BY u.created_at DESC, u.id DESC
   LIMIT 1`;

export interface LatestUpdateColumns {
  update_kind: UpdateKind | null;
  update_text: string | null;
  update_at: Date | null;
  update_org: string | null;
}

export function responderStatusOf(row: LatestUpdateColumns): ResponderStatus | null {
  if (!row.update_kind || !row.update_at || !row.update_org) return null;
  const text = row.update_text ?? (row.update_kind === "note" ? "" : UPDATE_TEXT[row.update_kind]);
  return {
    kind: row.update_kind,
    organisation: row.update_org,
    text,
    at: floorToMinute(row.update_at),
  };
}

function toQueueItem(row: IncidentRow, now: Date): QueueItem {
  return {
    id: row.id,
    categoryId: row.category_id as QueueItem["categoryId"],
    severity: row.severity,
    state: row.state,
    reportCount: row.report_count,
    independentReports: row.independent_reports,
    firstReportedAt: row.first_reported_at.toISOString(),
    lastReportAt: row.last_report_at.toISOString(),
    publishAfter: row.publish_after?.toISOString() ?? null,
    cell: row.public_cell,
    reviewDueInMs: row.first_reported_at.getTime() + REVIEW_SLA_MS[row.severity] - now.getTime(),
  };
}

export async function moderationQueue(
  deps: ServiceDeps,
  state: IncidentState,
): Promise<QueueItem[]> {
  const now = deps.now();
  const { rows } = await deps.pool.query<IncidentRow>(
    `SELECT ${INCIDENT_COLUMNS}
       FROM incidents
      WHERE state = $1
      ORDER BY ${SEVERITY_ORDER_SQL}, first_reported_at ASC
      LIMIT ${QUEUE_LIMIT}`,
    [state],
  );
  return rows.map((row) => toQueueItem(row, now));
}

interface ReportRow {
  id: string;
  key_id: string;
  channel: string;
  proximity: ProximityBand;
  location_enc: Buffer;
  description_enc: Buffer | null;
  occurred_at: Date | null;
  received_at: Date;
}

interface AuditRow {
  id: string;
  at: Date;
  actor_type: string;
  actor_id: string;
  action: string;
  reason: string | null;
  email: string | null;
}

function allowedActions(state: IncidentState, category: Category) {
  return MODERATION_ACTIONS.filter((action) => applyAction(state, action, category).ok);
}

/** Decrypted reports for staff screens. Callers must write the restricted-view audit entry. */
export async function decryptReports(
  deps: ServiceDeps,
  client: Client,
  incidentId: string,
): Promise<ModeratorReport[]> {
  const reports = await client.query<ReportRow>(
    `SELECT id, key_id, channel, proximity, location_enc, description_enc, occurred_at, received_at
       FROM reports WHERE incident_id = $1 ORDER BY received_at ASC`,
    [incidentId],
  );
  return reports.rows.map((report) => {
    const location = deps.cipher.decryptJson<{
      lat: number;
      lng: number;
      accuracyM: number | null;
    }>("report.location", report.key_id, report.location_enc);
    return {
      id: report.id,
      receivedAt: report.received_at.toISOString(),
      occurredAt: report.occurred_at?.toISOString() ?? null,
      channel: report.channel,
      proximity: report.proximity,
      description: report.description_enc
        ? deps.cipher.decrypt("report.description", report.key_id, report.description_enc)
        : null,
      location,
    };
  });
}

/**
 * Full incident for a moderator, including decrypted exact locations and text. Every call is
 * written to the audit log because it reads Restricted data.
 */
export async function incidentDetail(
  deps: ServiceDeps,
  incidentId: string,
  staff: StaffUser,
): Promise<IncidentDetail | null> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const incident = await client.query<IncidentRow>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1`,
      [incidentId],
    );
    const row = incident.rows[0];
    if (!row) return null;
    const category = getCategory(row.category_id);
    if (!category) return null;

    const decrypted = await decryptReports(deps, client, incidentId);

    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "incident.view_restricted",
      objectType: "incident",
      objectId: incidentId,
      details: { reports: decrypted.length },
    });

    const audit = await client.query<AuditRow>(
      `SELECT a.id, a.at, a.actor_type, a.actor_id, a.action, a.reason, s.email
         FROM audit_events a
         LEFT JOIN staff s ON a.actor_type = 'staff' AND s.id::text = a.actor_id
        WHERE a.object_type = 'incident' AND a.object_id = $1
        ORDER BY a.id DESC
        LIMIT 100`,
      [incidentId],
    );

    return {
      ...toQueueItem(row, now),
      publicLabel: publicLabel(row.state, row.independent_reports + row.confirmations),
      confirmations: row.confirmations,
      overVotes: row.over_votes,
      falseVotes: row.false_votes,
      reports: decrypted,
      audit: audit.rows.map((entry) => ({
        id: entry.id,
        at: entry.at.toISOString(),
        actor:
          entry.actor_type === "system"
            ? `system (${entry.actor_id})`
            : (entry.email ?? entry.actor_id),
        action: entry.action,
        reason: entry.reason,
      })),
      allowedActions: allowedActions(row.state, category),
    };
  });
}

export type ModerationResult =
  | { ok: true; id: string; previousState: IncidentState; state: IncidentState }
  | { ok: false; status: 404 | 409; message: string };

export async function moderateIncident(
  deps: ServiceDeps,
  incidentId: string,
  staff: StaffUser,
  decision: ModerationDecision,
): Promise<ModerationResult> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<IncidentRow>(
      `SELECT ${INCIDENT_COLUMNS} FROM incidents WHERE id = $1 FOR UPDATE`,
      [incidentId],
    );
    const row = rows[0];
    const category = row ? getCategory(row.category_id) : undefined;
    if (!row || !category) return { ok: false, status: 404, message: "Incident not found." };

    const result = applyAction(row.state, decision.action, category);
    if (!result.ok) return { ok: false, status: 409, message: result.error };
    const before = await loadIncidentForAlert(client, incidentId);
    const wasLive = before ? isActiveLive(before, now) : false;

    await client.query(
      `UPDATE incidents
          SET state = $2,
              updated_at = $3,
              verified_at = CASE WHEN $4 THEN $3 ELSE verified_at END,
              publish_after = CASE WHEN $4 THEN LEAST(COALESCE(publish_after, $3), $3) ELSE publish_after END,
              resolved_at = CASE WHEN $5 THEN $3 WHEN $6 THEN NULL ELSE resolved_at END
        WHERE id = $1`,
      [
        incidentId,
        result.state,
        now,
        decision.action === "verify",
        decision.action === "resolve",
        decision.action === "reopen",
      ],
    );

    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: `incident.${decision.action}`,
      objectType: "incident",
      objectId: incidentId,
      reason: decision.reason ?? null,
      details: { from: row.state, to: result.state },
    });
    await alertForTransition(client, incidentId, { wasLive, previousState: row.state }, now);

    return { ok: true, id: incidentId, previousState: row.state, state: result.state };
  });
}

/** Resolves incidents with no new reports within their active window, and tidies old rows. */
export async function runHousekeeping(deps: ServiceDeps): Promise<{ expired: number }> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const expired = await client.query<{ id: string; was_live: boolean; previous: IncidentState }>(
      `UPDATE incidents AS i
          SET state = 'resolved', resolved_at = $1, updated_at = $1
         FROM incidents AS old
        WHERE old.id = i.id
          AND i.state = ANY('{unconfirmed,verified,disputed}'::text[])
          AND i.active_until < $1
        RETURNING i.id, old.state AS previous,
          (i.handling = 'public' AND i.publish_after IS NOT NULL AND i.publish_after <= $1) AS was_live`,
      [now],
    );
    for (const row of expired.rows) {
      await alertForTransition(
        client,
        row.id,
        { wasLive: row.was_live, previousState: row.previous },
        now,
      );
      await appendAudit(client, {
        at: now,
        actorType: "system",
        actorId: "expiry",
        action: "incident.expired",
        objectType: "incident",
        objectId: row.id,
        reason: "No new reports within the active window",
      });
    }
    await client.query("DELETE FROM idempotency_keys WHERE created_at < $1", [
      new Date(now.getTime() - 24 * 3_600_000),
    ]);
    await client.query("DELETE FROM staff_sessions WHERE expires_at < $1", [now]);
    return { expired: expired.rowCount ?? 0 };
  });
}
