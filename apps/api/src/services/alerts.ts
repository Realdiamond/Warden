// The alert feed: one event per public change (new, upgraded, resolved, correction, broadcast).
// Phones fetch events for coarse tiles and match them to their saved places locally.

import {
  type AlertKind,
  type AlertsQuery,
  type AlertsResponse,
  getCategory,
  type IncidentState,
  type PublicAlert,
  publicLabel,
  type Severity,
  tierFor,
  tileFor,
} from "@warden/shared";
import { cellCenter } from "@warden/shared/geo";
import type { Client } from "../db/pool.ts";
import type { ServiceDeps } from "./deps.ts";

/** Events are served only once they are this old, so a slow transaction cannot be skipped. */
const SETTLE_MS = 5_000;
/** A phone asking for the first time gets the last six hours. */
const FIRST_FETCH_WINDOW_MS = 6 * 3_600_000;
const FEED_LIMIT = 200;

export interface IncidentForAlert {
  id: string;
  category_id: string;
  severity: Severity;
  handling: "public" | "private";
  state: IncidentState;
  public_cell: string;
  independent_reports: number;
  confirmations: number;
  publish_after: Date | null;
  source: string;
}

const COLUMNS =
  "id, category_id, severity, handling, state, public_cell, independent_reports, confirmations, publish_after, source";

export async function loadIncidentForAlert(
  client: Client,
  incidentId: string,
): Promise<IncidentForAlert | null> {
  const { rows } = await client.query<IncidentForAlert>(
    `SELECT ${COLUMNS} FROM incidents WHERE id = $1`,
    [incidentId],
  );
  return rows[0] ?? null;
}

const ACTIVE_PUBLIC_STATES: readonly IncidentState[] = ["unconfirmed", "verified", "disputed"];

/** True when the public can see the incident right now as something still going on. */
export function isActiveLive(incident: IncidentForAlert, now: Date): boolean {
  return (
    incident.handling === "public" &&
    ACTIVE_PUBLIC_STATES.includes(incident.state) &&
    incident.publish_after !== null &&
    incident.publish_after <= now
  );
}

/** Writes an alert for the incident as it now stands. Private categories never alert. */
export async function recordIncidentAlert(
  client: Client,
  incident: IncidentForAlert,
  kind: AlertKind,
  visibleAt: Date,
  now: Date,
): Promise<void> {
  if (incident.handling !== "public" || !getCategory(incident.category_id)) return;
  const center = cellCenter(incident.public_cell);
  await client.query(
    `INSERT INTO alert_events
       (incident_id, kind, tier, category_id, label, lat, lng, tile, source, visible_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      incident.id,
      kind,
      tierFor(incident.severity),
      incident.category_id,
      publicLabel(incident.state, incident.independent_reports + incident.confirmations),
      center.lat,
      center.lng,
      tileFor(center.lat, center.lng),
      // Demo incidents are labelled so phones never present them as real.
      incident.source === "demo" ? "demo" : null,
      visibleAt,
      now,
    ],
  );
}

/** Drops alerts that are scheduled but not yet visible, e.g. when a moderator removes a report. */
export async function withdrawPendingAlerts(
  client: Client,
  incidentId: string,
  now: Date,
): Promise<void> {
  await client.query("DELETE FROM alert_events WHERE incident_id = $1 AND visible_at > $2", [
    incidentId,
    now,
  ]);
}

export interface TransitionContext {
  /** Whether the incident was active and visible to the public just before the change. */
  wasLive: boolean;
  previousState: IncidentState;
}

/** Records what a state change means for people who were warned. Call after updating the row. */
export async function alertForTransition(
  client: Client,
  incidentId: string,
  before: TransitionContext,
  now: Date,
): Promise<void> {
  const incident = await loadIncidentForAlert(client, incidentId);
  if (!incident || incident.state === before.previousState) return;
  if (incident.state === "verified") {
    await withdrawPendingAlerts(client, incidentId, now);
    await recordIncidentAlert(client, incident, before.wasLive ? "upgraded" : "new", now, now);
    return;
  }
  if (isActiveLive(incident, now)) {
    // Still on the map; tell people who were warned if it is now in doubt.
    if (before.wasLive && incident.state === "disputed") {
      await recordIncidentAlert(client, incident, "correction", now, now);
    }
    return;
  }
  // No longer an active public incident: withdraw anything scheduled, tell those already warned.
  await withdrawPendingAlerts(client, incidentId, now);
  if (!before.wasLive) return;
  const kind: AlertKind = incident.state === "resolved" ? "resolved" : "correction";
  await recordIncidentAlert(client, incident, kind, now, now);
}

interface FeedRow {
  id: string;
  broadcast_id: string | null;
  organisation: string | null;
  radius_m: number | null;
  key_id: string | null;
  signature: Buffer | null;
  expires_at: Date | null;
  b_lat: number | null;
  b_lng: number | null;
  incident_id: string | null;
  kind: AlertKind;
  tier: PublicAlert["tier"];
  category_id: string | null;
  label: string | null;
  lat: number;
  lng: number;
  message: string | null;
  source: string | null;
  visible_at: Date;
}

function parseCursor(cursor: string): { at: Date; id: string } {
  const [ms, id] = cursor.split("_");
  return { at: new Date(Number(ms)), id: id ?? "0" };
}

export async function alertFeed(deps: ServiceDeps, query: AlertsQuery): Promise<AlertsResponse> {
  const now = deps.now();
  const upTo = new Date(now.getTime() - SETTLE_MS);
  const after = query.after
    ? parseCursor(query.after)
    : { at: new Date(now.getTime() - FIRST_FETCH_WINDOW_MS), id: "0" };

  const { rows } = await deps.pool.query<FeedRow>(
    `SELECT e.id, e.incident_id, e.kind, e.tier, e.category_id, e.label, e.lat, e.lng, e.message,
            e.source, e.visible_at, e.broadcast_id, o.name AS organisation, b.radius_m, b.key_id,
            b.signature, b.expires_at, b.lat AS b_lat, b.lng AS b_lng
       FROM alert_events e
       LEFT JOIN broadcasts b ON b.id = e.broadcast_id
       LEFT JOIN organisations o ON o.id = b.organisation_id
      WHERE e.tile = ANY($1::text[])
        AND e.visible_at <= $2
        AND (e.visible_at, e.id) > ($3, $4::bigint)
        AND (b.id IS NULL OR b.withdrawn_at IS NULL)
      ORDER BY e.visible_at, e.id
      LIMIT $5`,
    [query.tiles, upTo, after.at, after.id, FEED_LIMIT],
  );

  const alerts: PublicAlert[] = rows.map((row) => ({
    id: `${row.visible_at.getTime()}_${row.id}`,
    incidentId: row.incident_id,
    kind: row.kind,
    tier: row.tier,
    categoryId: row.category_id as PublicAlert["categoryId"],
    label: row.label as PublicAlert["label"],
    center: { lat: row.lat, lng: row.lng },
    message: row.message,
    source: row.source,
    visibleAt: row.visible_at.toISOString(),
    broadcast:
      row.broadcast_id &&
      row.organisation &&
      row.radius_m !== null &&
      row.key_id &&
      row.signature &&
      row.expires_at &&
      row.b_lat !== null &&
      row.b_lng !== null &&
      row.message
        ? {
            id: row.broadcast_id,
            organisation: row.organisation,
            tier: row.tier,
            center: { lat: row.b_lat, lng: row.b_lng },
            radiusM: row.radius_m,
            message: row.message,
            expiresAt: row.expires_at.toISOString(),
            keyId: row.key_id,
            signature: row.signature.toString("base64"),
          }
        : null,
  }));
  const last = alerts.at(-1);
  return { alerts, cursor: last ? last.id : (query.after ?? null) };
}
