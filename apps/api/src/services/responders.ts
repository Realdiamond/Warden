// Verified responder organisations (PRD modules 10 to 12). Responders see public-category
// incidents inside their jurisdiction, post public updates, mark deployments, send signed
// broadcasts, and see SOS sessions whose owners chose to share them. Every read of exact
// locations and every action is written to the audit log.

import { randomUUID } from "node:crypto";
import {
  type BroadcastInput,
  broadcastSigningText,
  type DeploymentInput,
  type DeploymentKind,
  type DeploymentVisibility,
  type IncidentState,
  type IncidentUpdateInput,
  type ModeratorReport,
  type OrganisationKind,
  type PublicPresence,
  publicLabel,
  type ResponderDeployment,
  type ResponderInboxItem,
  type Severity,
  type SignedBroadcast,
  type SosBoardItem,
  type StaffUser,
  tilesForCircle,
} from "@warden/shared";
import { cellBoundary, cellCenter, cellsFor } from "@warden/shared/geo";
import { type Client, type Pool, withTransaction } from "../db/pool.ts";
import { alertForTransition, isActiveLive, loadIncidentForAlert } from "./alerts.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";
import {
  decryptReports,
  LATEST_UPDATE_SQL,
  type LatestUpdateColumns,
  responderStatusOf,
} from "./incidents.ts";

export type ResponderFailure = { ok: false; status: 403 | 404 | 409 | 503; message: string };

const INBOX_WINDOW_MS = 24 * 3_600_000;
const NOT_FOUND: ResponderFailure = { ok: false, status: 404, message: "Not found." };

function orgId(staff: StaffUser): string {
  if (staff.role !== "responder" || !staff.organisation) {
    throw new Error("Responder routes need a responder with an organisation");
  }
  return staff.organisation.id;
}

// ---------------------------------------------------------------------------------------------
// Organisations (created by an administrator from the command line)

export async function createOrganisation(
  pool: Pool,
  input: {
    name: string;
    kind: OrganisationKind;
    /** GeoJSON Polygon or MultiPolygon; null for a national organisation. */
    jurisdiction: unknown | null;
  },
  now: Date,
): Promise<{ id: string }> {
  const id = randomUUID();
  return withTransaction(pool, async (client) => {
    await client.query(
      `INSERT INTO organisations (id, name, kind, jurisdiction, created_at)
       VALUES ($1, $2, $3,
               CASE WHEN $4::text IS NULL THEN NULL
                    ELSE ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($4::text), 4326)) END,
               $5)`,
      [
        id,
        input.name.trim(),
        input.kind,
        input.jurisdiction ? JSON.stringify(input.jurisdiction) : null,
        now,
      ],
    );
    await appendAudit(client, {
      at: now,
      actorType: "system",
      actorId: "cli",
      action: "organisation.created",
      objectType: "organisation",
      objectId: id,
      details: { name: input.name.trim(), kind: input.kind, national: !input.jurisdiction },
    });
    return { id };
  });
}

/** SQL condition: the geometry expression lies in organisation $n's jurisdiction. */
function inJurisdiction(geometry: string, orgParam: string): string {
  return `EXISTS (SELECT 1 FROM organisations jo
                   WHERE jo.id = ${orgParam}
                     AND (jo.jurisdiction IS NULL OR ST_Intersects(jo.jurisdiction, ${geometry})))`;
}

// ---------------------------------------------------------------------------------------------
// Incidents

interface InboxRow extends LatestUpdateColumns {
  id: string;
  category_id: string;
  severity: Severity;
  state: IncidentState;
  public_cell: string;
  report_count: number;
  independent_reports: number;
  confirmations: number;
  first_reported_at: Date;
  last_report_at: Date;
}

/**
 * Responders see public-category incidents that are live on the map, plus critical ones still
 * held for review (marked unverified), because minutes matter for those. Private categories
 * (sexual and domestic violence, missing persons) never reach responders through Warden.
 */
const RESPONDER_VISIBLE = `
  incidents.handling = 'public'
  AND (
    (incidents.state = ANY('{unconfirmed,verified,disputed}'::text[])
       AND incidents.publish_after IS NOT NULL AND incidents.publish_after <= $2)
    OR (incidents.state = 'held' AND incidents.severity = 'critical')
  )`;

function toInboxItem(row: InboxRow): ResponderInboxItem {
  return {
    id: row.id,
    categoryId: row.category_id,
    severity: row.severity,
    state: row.state,
    label: publicLabel(row.state, row.independent_reports + row.confirmations),
    reportCount: row.report_count,
    firstReportedAt: row.first_reported_at.toISOString(),
    lastReportAt: row.last_report_at.toISOString(),
    center: cellCenter(row.public_cell),
    latestUpdate: responderStatusOf(row),
  };
}

const INBOX_COLUMNS = `incidents.id, incidents.category_id, incidents.severity, incidents.state,
  incidents.public_cell, incidents.report_count, incidents.independent_reports,
  incidents.confirmations, incidents.first_reported_at, incidents.last_report_at`;

export async function responderInbox(
  deps: ServiceDeps,
  staff: StaffUser,
): Promise<ResponderInboxItem[]> {
  const now = deps.now();
  const { rows } = await deps.pool.query<InboxRow>(
    `SELECT ${INBOX_COLUMNS}, lu.*
       FROM incidents
       LEFT JOIN LATERAL (${LATEST_UPDATE_SQL}) lu ON true
      WHERE ${RESPONDER_VISIBLE}
        AND incidents.last_report_at >= $3
        AND ${inJurisdiction("incidents.public_point", "$1")}
      ORDER BY CASE incidents.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,
               incidents.last_report_at DESC
      LIMIT 200`,
    [orgId(staff), now, new Date(now.getTime() - INBOX_WINDOW_MS)],
  );
  return rows.map(toInboxItem);
}

export interface ResponderIncidentDetail extends ResponderInboxItem {
  reports: ModeratorReport[];
  updates: { kind: string; text: string | null; organisation: string; at: string }[];
}

async function lockVisibleIncident(
  client: Client,
  staff: StaffUser,
  incidentId: string,
  now: Date,
): Promise<InboxRow | null> {
  const { rows } = await client.query<InboxRow>(
    `SELECT ${INBOX_COLUMNS}, lu.*
       FROM incidents
       LEFT JOIN LATERAL (${LATEST_UPDATE_SQL}) lu ON true
      WHERE incidents.id = $3
        AND ${RESPONDER_VISIBLE}
        AND ${inJurisdiction("incidents.public_point", "$1")}
      FOR UPDATE OF incidents`,
    [orgId(staff), now, incidentId],
  );
  return rows[0] ?? null;
}

export async function responderIncident(
  deps: ServiceDeps,
  staff: StaffUser,
  incidentId: string,
): Promise<ResponderIncidentDetail | null> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const row = await lockVisibleIncident(client, staff, incidentId, now);
    if (!row) return null;
    const reports = await decryptReports(deps, client, incidentId);
    const updates = await client.query<{
      kind: string;
      public_text: string | null;
      name: string;
      created_at: Date;
    }>(
      `SELECT u.kind, u.public_text, o.name, u.created_at
         FROM incident_updates u JOIN organisations o ON o.id = u.organisation_id
        WHERE u.incident_id = $1 ORDER BY u.created_at DESC, u.id DESC LIMIT 50`,
      [incidentId],
    );
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "incident.view_restricted",
      objectType: "incident",
      objectId: incidentId,
      details: { organisationId: orgId(staff), reports: reports.length },
    });
    return {
      ...toInboxItem(row),
      reports,
      updates: updates.rows.map((u) => ({
        kind: u.kind,
        text: u.public_text,
        organisation: u.name,
        at: u.created_at.toISOString(),
      })),
    };
  });
}

export async function postIncidentUpdate(
  deps: ServiceDeps,
  staff: StaffUser,
  incidentId: string,
  input: IncidentUpdateInput,
): Promise<{ ok: true; state: IncidentState } | ResponderFailure> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const row = await lockVisibleIncident(client, staff, incidentId, now);
    if (!row) return NOT_FOUND;
    const before = await loadIncidentForAlert(client, incidentId);
    const wasLive = before ? isActiveLive(before, now) : false;

    await client.query(
      `INSERT INTO incident_updates (incident_id, organisation_id, staff_id, kind, public_text, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [incidentId, orgId(staff), staff.id, input.kind, input.publicText ?? null, now],
    );
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "incident.responder_update",
      objectType: "incident",
      objectId: incidentId,
      reason: input.publicText ?? null,
      details: { kind: input.kind, organisationId: orgId(staff) },
    });

    let state = row.state;
    if (input.kind === "resolved") {
      state = "resolved";
      await client.query(
        "UPDATE incidents SET state = 'resolved', resolved_at = $2, updated_at = $2 WHERE id = $1",
        [incidentId, now],
      );
      await appendAudit(client, {
        at: now,
        actorType: "staff",
        actorId: staff.id,
        action: "incident.resolve",
        objectType: "incident",
        objectId: incidentId,
        reason: "Closed by responders",
        details: { from: row.state, to: "resolved", organisationId: orgId(staff) },
      });
      await alertForTransition(client, incidentId, { wasLive, previousState: row.state }, now);
    }
    return { ok: true, state };
  });
}

// ---------------------------------------------------------------------------------------------
// Deployments

interface DeploymentRow {
  id: string;
  label: string;
  kind: DeploymentKind;
  visibility: DeploymentVisibility;
  lat: number;
  lng: number;
  starts_at: Date;
  ends_at: Date;
  organisation_id: string;
  org_name: string;
}

export async function createDeployment(
  deps: ServiceDeps,
  staff: StaffUser,
  input: DeploymentInput,
): Promise<{ ok: true; id: string } | ResponderFailure> {
  const now = deps.now();
  const org = orgId(staff);
  const cells = cellsFor(input.location.lat, input.location.lng);
  const publicCell = input.visibility === "public_area" ? cells.r7 : cells.r9;
  return withTransaction(deps.pool, async (client) => {
    const inside = await client.query(
      `SELECT 1 WHERE ${inJurisdiction("ST_SetSRID(ST_MakePoint($2, $3), 4326)", "$1")}`,
      [org, input.location.lng, input.location.lat],
    );
    if (!inside.rowCount) {
      return { ok: false, status: 403, message: "That place is outside your organisation's area." };
    }
    const id = randomUUID();
    await client.query(
      `INSERT INTO deployments
         (id, organisation_id, staff_id, label, kind, visibility, location, public_cell,
          starts_at, ends_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326), $9, $10, $11, $10)`,
      [
        id,
        org,
        staff.id,
        input.label,
        input.kind,
        input.visibility,
        input.location.lng,
        input.location.lat,
        publicCell,
        now,
        new Date(now.getTime() + input.durationMinutes * 60_000),
      ],
    );
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "deployment.created",
      objectType: "deployment",
      objectId: id,
      details: { kind: input.kind, visibility: input.visibility, organisationId: org },
    });
    return { ok: true, id };
  });
}

export async function endDeployment(
  deps: ServiceDeps,
  staff: StaffUser,
  deploymentId: string,
): Promise<{ ok: true } | ResponderFailure> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const result = await client.query(
      `UPDATE deployments SET ended_at = $3
        WHERE id = $1 AND organisation_id = $2 AND ended_at IS NULL`,
      [deploymentId, orgId(staff), now],
    );
    if (!result.rowCount) return NOT_FOUND;
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "deployment.ended",
      objectType: "deployment",
      objectId: deploymentId,
    });
    return { ok: true };
  });
}

/** Own organisation's deployments, and other organisations' unless hidden, in our area. */
export async function listDeployments(
  deps: ServiceDeps,
  staff: StaffUser,
): Promise<ResponderDeployment[]> {
  const now = deps.now();
  const org = orgId(staff);
  const { rows } = await deps.pool.query<DeploymentRow>(
    `SELECT d.id, d.label, d.kind, d.visibility, ST_Y(d.location) AS lat, ST_X(d.location) AS lng,
            d.starts_at, d.ends_at, d.organisation_id, o.name AS org_name
       FROM deployments d JOIN organisations o ON o.id = d.organisation_id
      WHERE d.ended_at IS NULL AND d.ends_at > $2
        AND (d.organisation_id = $1
             OR (d.visibility <> 'hidden' AND ${inJurisdiction("d.location", "$1")}))
      ORDER BY d.starts_at DESC
      LIMIT 300`,
    [org, now],
  );
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    kind: row.kind,
    visibility: row.visibility,
    location: { lat: row.lat, lng: row.lng },
    startsAt: row.starts_at.toISOString(),
    endsAt: row.ends_at.toISOString(),
    organisation: row.org_name,
    mine: row.organisation_id === org,
  }));
}

/** Public presence layer: only deployments marked public, and only as areas. */
export async function publicPresence(
  deps: ServiceDeps,
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number },
): Promise<PublicPresence[]> {
  const now = deps.now();
  const { rows } = await deps.pool.query<{
    id: string;
    kind: DeploymentKind;
    label: string;
    public_cell: string;
    ends_at: Date;
    org_name: string;
    org_kind: OrganisationKind;
  }>(
    `SELECT d.id, d.kind, d.label, d.public_cell, d.ends_at, o.name AS org_name, o.kind AS org_kind
       FROM deployments d JOIN organisations o ON o.id = d.organisation_id
      WHERE d.visibility IN ('public_street', 'public_area')
        AND d.ended_at IS NULL AND d.starts_at <= $1 AND d.ends_at > $1
        AND o.disabled_at IS NULL
        AND d.location && ST_MakeEnvelope($2, $3, $4, $5, 4326)
      LIMIT 300`,
    [now, bbox.minLng, bbox.minLat, bbox.maxLng, bbox.maxLat],
  );
  return rows.map((row) => ({
    id: row.id,
    kind: row.kind,
    organisationKind: row.org_kind,
    organisation: row.org_name,
    label: row.label,
    cell: row.public_cell,
    center: cellCenter(row.public_cell),
    boundary: cellBoundary(row.public_cell),
    until: row.ends_at.toISOString(),
  }));
}

// ---------------------------------------------------------------------------------------------
// Broadcasts

export async function createBroadcast(
  deps: ServiceDeps,
  staff: StaffUser,
  input: BroadcastInput,
): Promise<{ ok: true; broadcast: SignedBroadcast } | ResponderFailure> {
  const signer = deps.signer;
  if (!signer) {
    return { ok: false, status: 503, message: "Broadcasts are not set up on this server yet." };
  }
  const now = deps.now();
  const org = orgId(staff);
  const organisation = staff.organisation?.name ?? "";
  return withTransaction(deps.pool, async (client) => {
    const inside = await client.query(
      `SELECT 1 WHERE ${inJurisdiction("ST_SetSRID(ST_MakePoint($2, $3), 4326)", "$1")}`,
      [org, input.center.lng, input.center.lat],
    );
    if (!inside.rowCount) {
      return { ok: false, status: 403, message: "That place is outside your organisation's area." };
    }
    const payload = {
      id: randomUUID(),
      organisation,
      tier: input.tier,
      center: input.center,
      radiusM: input.radiusM,
      message: input.message,
      expiresAt: new Date(now.getTime() + input.expiresInMinutes * 60_000).toISOString(),
    };
    const signature = signer.sign(broadcastSigningText(payload));
    await client.query(
      `INSERT INTO broadcasts
         (id, organisation_id, staff_id, tier, message, lat, lng, radius_m, key_id, signature,
          expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        payload.id,
        org,
        staff.id,
        payload.tier,
        payload.message,
        payload.center.lat,
        payload.center.lng,
        payload.radiusM,
        signer.keyId,
        signature,
        new Date(payload.expiresAt),
        now,
      ],
    );
    for (const tile of tilesForCircle(input.center.lat, input.center.lng, input.radiusM)) {
      await client.query(
        `INSERT INTO alert_events
           (kind, tier, lat, lng, tile, message, source, broadcast_id, visible_at, created_at)
         VALUES ('broadcast', $1, $2, $3, $4, $5, $6, $7, $8, $8)`,
        [
          payload.tier,
          payload.center.lat,
          payload.center.lng,
          tile,
          payload.message,
          organisation,
          payload.id,
          now,
        ],
      );
    }
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "broadcast.sent",
      objectType: "broadcast",
      objectId: payload.id,
      reason: payload.message,
      details: { tier: payload.tier, radiusM: payload.radiusM, organisationId: org },
    });
    return {
      ok: true,
      broadcast: { ...payload, keyId: signer.keyId, signature: signature.toString("base64") },
    };
  });
}

export async function withdrawBroadcast(
  deps: ServiceDeps,
  staff: StaffUser,
  broadcastId: string,
): Promise<{ ok: true } | ResponderFailure> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const result = await client.query(
      `UPDATE broadcasts SET withdrawn_at = $3
        WHERE id = $1 AND organisation_id = $2 AND withdrawn_at IS NULL`,
      [broadcastId, orgId(staff), now],
    );
    if (!result.rowCount) return NOT_FOUND;
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "broadcast.withdrawn",
      objectType: "broadcast",
      objectId: broadcastId,
    });
    return { ok: true };
  });
}

export async function listBroadcasts(deps: ServiceDeps, staff: StaffUser) {
  const { rows } = await deps.pool.query<{
    id: string;
    tier: string;
    message: string;
    radius_m: number;
    created_at: Date;
    expires_at: Date;
    withdrawn_at: Date | null;
  }>(
    `SELECT id, tier, message, radius_m, created_at, expires_at, withdrawn_at
       FROM broadcasts WHERE organisation_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [orgId(staff)],
  );
  return rows.map((row) => ({
    id: row.id,
    tier: row.tier,
    message: row.message,
    radiusM: row.radius_m,
    createdAt: row.created_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    withdrawn: row.withdrawn_at !== null,
  }));
}

// ---------------------------------------------------------------------------------------------
// SOS board

export async function sosBoard(deps: ServiceDeps, staff: StaffUser): Promise<SosBoardItem[]> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const sessions = await client.query<{
      id: string;
      key_id: string;
      details_enc: Buffer;
      duress: boolean;
      started_at: Date;
    }>(
      `SELECT s.id, s.key_id, s.details_enc, s.duress, s.started_at
         FROM safety_sessions s
        WHERE s.kind = 'sos' AND s.share_with_responders AND s.state <> 'ended'
          AND s.last_area IS NOT NULL
          AND ${inJurisdiction("s.last_area", "$1")}
        ORDER BY s.started_at DESC
        LIMIT 100`,
      [orgId(staff)],
    );
    const items: SosBoardItem[] = [];
    for (const session of sessions.rows) {
      const details = deps.cipher.decryptJson<{ personName: string }>(
        "session.details",
        session.key_id,
        session.details_enc,
      );
      const point = await client.query<{ recorded_at: Date; key_id: string; point_enc: Buffer }>(
        `SELECT recorded_at, key_id, point_enc FROM session_points
          WHERE session_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT 1`,
        [session.id],
      );
      const last = point.rows[0];
      const decoded = last
        ? deps.cipher.decryptJson<{ lat: number; lng: number; accuracyM: number | null }>(
            "session.point",
            last.key_id,
            last.point_enc,
          )
        : null;
      items.push({
        sessionId: session.id,
        personName: details.personName,
        startedAt: session.started_at.toISOString(),
        duress: session.duress,
        lastPoint:
          decoded && last
            ? {
                lat: decoded.lat,
                lng: decoded.lng,
                accuracyM: decoded.accuracyM,
                at: last.recorded_at.toISOString(),
              }
            : null,
      });
    }
    await appendAudit(client, {
      at: now,
      actorType: "staff",
      actorId: staff.id,
      action: "sos.board_viewed",
      objectType: "organisation",
      objectId: orgId(staff),
      details: { sessions: items.map((item) => item.sessionId) },
    });
    return items;
  });
}

/** Keeps the coarse area of a shared SOS up to date for the board's area filter. */
export async function updateSessionArea(
  client: Client,
  sessionId: string,
  point: { lat: number; lng: number },
): Promise<void> {
  const area = cellCenter(cellsFor(point.lat, point.lng).r7);
  await client.query(
    `UPDATE safety_sessions SET last_area = ST_SetSRID(ST_MakePoint($2, $3), 4326)
      WHERE id = $1 AND share_with_responders`,
    [sessionId, area.lng, area.lat],
  );
}
