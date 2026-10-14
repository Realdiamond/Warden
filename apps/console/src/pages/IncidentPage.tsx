import { getCategory, type IncidentDetail, type ModerationAction } from "@warden/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { SeverityBadge, StateBadge } from "../components/Badges.tsx";
import { ReasonDialog } from "../components/ReasonDialog.tsx";
import { ACTION_LABEL, formatCoordinate, NEEDS_REASON, reviewDue, timeAgo } from "../format.ts";
import { routeHref } from "../router.ts";

// MapLibre is large; load it only when an incident is opened.
const IncidentMap = lazy(() =>
  import("../components/IncidentMap.tsx").then((module) => ({ default: module.IncidentMap })),
);

const PROXIMITY_LABEL = {
  here: "Reporter was within 500 m",
  near: "Reporter was within 2 km",
  far: "Reporter was more than 2 km away",
  unknown: "Reporter's distance unknown",
} as const;

export function IncidentPage({ id }: { id: string }) {
  const [incident, setIncident] = useState<IncidentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ModerationAction | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setIncident(await api.incident(id));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the incident.");
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: ModerationAction, reason?: string) {
    setBusy(true);
    setPending(null);
    try {
      await api.act(id, action, reason || undefined);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The action failed.");
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

  const category = getCategory(incident.categoryId);
  const isPrivate = category?.handling === "private";

  return (
    <article className="incident">
      <p>
        <a href={routeHref({ page: "queue", state: incident.state })}>← Back to queue</a>
      </p>
      <header className="incident-header">
        <h1>{category?.label ?? incident.categoryId}</h1>
        <div className="badges">
          <SeverityBadge severity={incident.severity} />
          <StateBadge state={incident.state} />
          {incident.publicLabel && (
            <span className="badge">Public label: {incident.publicLabel}</span>
          )}
          {isPrivate && <span className="tag">Private: never published</span>}
        </div>
        <p className="muted">
          {incident.reportCount} report{incident.reportCount === 1 ? "" : "s"} from{" "}
          {incident.independentReports} phone{incident.independentReports === 1 ? "" : "s"} · first{" "}
          {timeAgo(incident.firstReportedAt)} · latest {timeAgo(incident.lastReportAt)}
          {incident.state === "held" && ` · review ${reviewDue(incident.reviewDueInMs)}`}
        </p>
        {incident.confirmations + incident.overVotes + incident.falseVotes > 0 && (
          <p className="muted">
            People nearby: {incident.confirmations} still happening · {incident.overVotes} it's over
            · {incident.falseVotes} looks false
          </p>
        )}
      </header>

      <p className="restricted" role="note">
        Restricted data: exact locations and report text are shown to staff only, and opening this
        page was recorded in the audit log.
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      <section className="actions" aria-label="Actions">
        {incident.allowedActions.map((action) => (
          <button
            key={action}
            type="button"
            className={action === "verify" ? "primary" : action === "remove" ? "danger" : undefined}
            disabled={busy}
            onClick={() => setPending(action)}
          >
            {ACTION_LABEL[action]}
          </button>
        ))}
      </section>

      <div className="incident-grid">
        <section>
          <h2>Reports</h2>
          <ol className="reports">
            {incident.reports.map((report) => (
              <li key={report.id} className="card">
                <p className="report-meta">
                  {timeAgo(report.receivedAt)} via {report.channel} ·{" "}
                  {PROXIMITY_LABEL[report.proximity]}
                </p>
                <p>{report.description ?? <span className="muted">No description</span>}</p>
                <p className="muted mono">
                  {formatCoordinate(report.location.lat)}, {formatCoordinate(report.location.lng)}
                  {report.location.accuracyM !== null &&
                    ` (±${Math.round(report.location.accuracyM)} m)`}
                </p>
              </li>
            ))}
          </ol>
        </section>
        <section>
          <h2>Location</h2>
          <Suspense fallback={<p className="page-message">Loading map…</p>}>
            <IncidentMap cell={incident.cell} reports={incident.reports} />
          </Suspense>
        </section>
      </div>

      <section>
        <h2>Audit trail</h2>
        <ul className="audit">
          {incident.audit.map((entry) => (
            <li key={entry.id}>
              <span className="mono">{new Date(entry.at).toLocaleString()}</span> · {entry.actor} ·{" "}
              {entry.action}
              {entry.reason && <> · “{entry.reason}”</>}
            </li>
          ))}
        </ul>
      </section>

      {pending && (
        <ReasonDialog
          title={`${ACTION_LABEL[pending]}?`}
          confirmLabel={ACTION_LABEL[pending]}
          required={NEEDS_REASON.has(pending)}
          onCancel={() => setPending(null)}
          onConfirm={(reason) => void act(pending, reason)}
        />
      )}
    </article>
  );
}
