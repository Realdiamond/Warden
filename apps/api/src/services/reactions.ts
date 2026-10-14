// Community reactions (PRD module 7): people near an incident can say it is still happening,
// that it is over, or that it looks false. One reaction per phone per incident; the phone is
// identified only by an HMAC that cannot be linked across incidents or to its reports.

import {
  communityOutcome,
  type IncidentState,
  publicLabel,
  type ReactionKind,
  type ReactionResult,
} from "@warden/shared";
import { withTransaction } from "../db/pool.ts";
import { alertForTransition, type IncidentForAlert, isActiveLive } from "./alerts.ts";
import { appendAudit } from "./audit.ts";
import type { ServiceDeps } from "./deps.ts";

interface ReactionRow extends IncidentForAlert {
  over_votes: number;
  false_votes: number;
}

export type ReactionOutcome =
  | { ok: true; result: ReactionResult }
  | { ok: false; status: 404 | 409; message: string };

export async function reactToIncident(
  deps: ServiceDeps,
  input: { incidentId: string; installId: string; kind: ReactionKind },
): Promise<ReactionOutcome> {
  const now = deps.now();
  return withTransaction(deps.pool, async (client) => {
    const { rows } = await client.query<ReactionRow>(
      `SELECT id, category_id, severity, handling, state, public_cell, independent_reports,
              confirmations, over_votes, false_votes, publish_after, source
         FROM incidents WHERE id = $1 FOR UPDATE`,
      [input.incidentId],
    );
    const row = rows[0];
    if (!row) return { ok: false, status: 404, message: "Incident not found." };
    if (!isActiveLive(row, now)) {
      const closedButPublic =
        row.handling === "public" &&
        row.state === "resolved" &&
        row.publish_after !== null &&
        row.publish_after <= now;
      // Held, removed and private incidents are indistinguishable from ones that do not exist.
      return closedButPublic
        ? { ok: false, status: 409, message: "This incident is already closed." }
        : { ok: false, status: 404, message: "Incident not found." };
    }

    const label = () => publicLabel(row.state, row.independent_reports + row.confirmations);

    if (input.kind === "confirm") {
      // Someone who reported this incident is already counted.
      const reported = await client.query(
        "SELECT 1 FROM reports WHERE incident_id = $1 AND device_tag = $2 LIMIT 1",
        [row.id, deps.hasher.hmac("device-incident", input.installId, row.id)],
      );
      if (reported.rowCount) return { ok: true, result: { accepted: false, label: label() } };
    }

    const inserted = await client.query(
      `INSERT INTO incident_reactions (incident_id, device_tag, kind, created_at)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [row.id, deps.hasher.hmac("device-reaction", input.installId, row.id), input.kind, now],
    );
    if (!inserted.rowCount) return { ok: true, result: { accepted: false, label: label() } };

    const updated = await client.query<{
      confirmations: number;
      over_votes: number;
      false_votes: number;
    }>(
      `UPDATE incidents
          SET confirmations = confirmations + ($2 = 'confirm')::int,
              over_votes = over_votes + ($2 = 'over')::int,
              false_votes = false_votes + ($2 = 'false')::int
        WHERE id = $1
        RETURNING confirmations, over_votes, false_votes`,
      [row.id, input.kind],
    );
    const counts = updated.rows[0];
    if (!counts) return { ok: false, status: 404, message: "Incident not found." };
    row.confirmations = counts.confirmations;
    row.over_votes = counts.over_votes;
    row.false_votes = counts.false_votes;

    const next = communityOutcome(row.state, row.severity, {
      confirmations: row.independent_reports + counts.confirmations,
      overVotes: counts.over_votes,
      falseVotes: counts.false_votes,
    });
    if (next) {
      const previous: IncidentState = row.state;
      await client.query(
        `UPDATE incidents
            SET state = $2, updated_at = $3,
                resolved_at = CASE WHEN $2 = 'resolved' THEN $3 ELSE resolved_at END
          WHERE id = $1`,
        [row.id, next, now],
      );
      await appendAudit(client, {
        at: now,
        actorType: "system",
        actorId: "community",
        action: next === "resolved" ? "incident.community_resolved" : "incident.community_disputed",
        objectType: "incident",
        objectId: row.id,
        reason:
          next === "resolved"
            ? "Enough people nearby said it is over"
            : "Enough people nearby said it looks false",
        details: {
          from: previous,
          to: next,
          confirmations: counts.confirmations,
          overVotes: counts.over_votes,
          falseVotes: counts.false_votes,
        },
      });
      await alertForTransition(client, row.id, { wasLive: true, previousState: previous }, now);
      row.state = next;
    }

    return { ok: true, result: { accepted: true, label: label() } };
  });
}
