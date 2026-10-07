import {
  getCategory,
  MAX_UPDATE_TEXT,
  type ModeratorReport,
  type ResponderIncidentDetail,
  UPDATE_TEXT,
  type UpdateKind,
} from "@warden/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { SeverityBadge } from "../components/Badges.tsx";
import { formatCoordinate, timeAgo } from "../format.ts";
import { routeHref } from "../router.ts";

const IncidentMap = lazy(() =>
  import("../components/IncidentMap.tsx").then((module) => ({ default: module.IncidentMap })),
);

const ACTIONS: Exclude<UpdateKind, "note">[] = [
  "acknowledged",
  "responding",
  "on_scene",
  "resolved",
];
const ACTION_LABEL: Record<Exclude<UpdateKind, "note">, string> = {
  acknowledged: "We have seen this",
  responding: "We are on the way",
  on_scene: "We are on scene",
  resolved: "Close: it is over",
};

export function ResponderIncidentPage({ id }: { id: string }) {
  const [incident, setIncident] = useState<ResponderIncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setIncident(await api.responder.incident(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the incident.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function post(kind: UpdateKind, publicText?: string) {
    if (kind === "resolved" && !window.confirm("Close this incident for everyone?")) return;
    setBusy(true);
    try {
      await api.responder.update(id, publicText ? { kind, publicText } : { kind });
      setNote("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The update failed.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !incident) {
    return (
      <p className="error" role="alert">
        {error}
      </p>
    );
  }
  if (!incident) return <p className="page-message">Loading…</p>;

  const reports: ModeratorReport[] = incident.reports.map((r) => ({
    ...r,
    proximity: r.proximity as ModeratorReport["proximity"],
  }));

  return (
    <article className="incident">
      <p>
        <a href={routeHref({ page: "r-incidents" })}>← Back to incidents</a>
      </p>
      <header className="incident-header">
        <h1>{getCategory(incident.categoryId)?.label ?? incident.categoryId}</h1>
        <div className="badges">
          <SeverityBadge severity={incident.severity} />
          <span className="badge">
            {incident.state === "held"
              ? "Not yet checked by Warden"
              : (incident.label ?? incident.state)}
          </span>
        </div>
        <p className="muted">
          {incident.reportCount} report{incident.reportCount === 1 ? "" : "s"} · first{" "}
          {timeAgo(incident.firstReportedAt)} · latest {timeAgo(incident.lastReportAt)}
        </p>
      </header>

      <p className="restricted" role="note">
        Restricted data: exact locations and report text are for responding only. Opening this page
        was recorded in the audit log.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="actions" aria-label="Public updates">
        {ACTIONS.map((kind) => (
          <button
            key={kind}
            type="button"
            className={kind === "resolved" ? "danger" : "primary"}
            disabled={busy}
            onClick={() => void post(kind)}
          >
            {ACTION_LABEL[kind]}
          </button>
        ))}
      </section>
      <form
        className="card note-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (note.trim()) void post("note", note.trim());
        }}
      >
        <label>
          Public note (shown on the map; no names, plates or exact addresses)
          <textarea
            value={note}
            maxLength={MAX_UPDATE_TEXT}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
        </label>
        <button type="submit" disabled={busy || !note.trim()}>
          Post note
        </button>
      </form>

      <div className="incident-grid">
        <section aria-label="Map">
          <Suspense fallback={<div className="map map-loading">Loading map…</div>}>
            <IncidentMap cell={incident.cell} reports={reports} />
          </Suspense>
        </section>
        <section className="reports" aria-label="Reports">
          <h2>Reports</h2>
          {incident.reports.map((report) => (
            <div key={report.id} className="card">
              <p className="report-meta">
                {timeAgo(report.receivedAt)} ·{" "}
                {report.channel === "ussd" ? "USSD (area only)" : report.channel}
              </p>
              {report.description && <p>{report.description}</p>}
              <p className="mono">
                {formatCoordinate(report.location.lat)}, {formatCoordinate(report.location.lng)}
                {report.location.accuracyM !== null &&
                  ` ±${Math.round(report.location.accuracyM)} m`}
              </p>
            </div>
          ))}
          <h2>Updates</h2>
          {incident.updates.length === 0 && <p className="muted">No updates yet.</p>}
          {incident.updates.map((update) => (
            <p key={`${update.at}-${update.kind}`} className="card">
              <strong>{update.organisation}</strong> · {timeAgo(update.at)}
              <br />
              {update.text ??
                (update.kind in UPDATE_TEXT
                  ? UPDATE_TEXT[update.kind as keyof typeof UPDATE_TEXT]
                  : update.kind)}
            </p>
          ))}
        </section>
      </div>
    </article>
  );
}
