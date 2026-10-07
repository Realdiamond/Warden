import { getCategory, type ResponderInboxItem } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { SeverityBadge } from "../components/Badges.tsx";
import { timeAgo } from "../format.ts";
import { routeHref } from "../router.ts";

const REFRESH_MS = 15_000;

export function ResponderInboxPage() {
  const [items, setItems] = useState<ResponderInboxItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setItems((await api.responder.incidents()).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load incidents.");
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <section>
      <h1>Incidents in your area</h1>
      <p className="muted">
        Last 24 hours. Items marked "Not yet checked" are critical reports Warden has not verified.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && <p className="page-message">Loading…</p>}
      {items?.length === 0 && <p className="page-message">No incidents in your area right now.</p>}
      {items && items.length > 0 && (
        <table className="queue">
          <thead>
            <tr>
              <th scope="col">Severity</th>
              <th scope="col">What</th>
              <th scope="col">Status</th>
              <th scope="col">Reports</th>
              <th scope="col">Latest</th>
              <th scope="col">Responders</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  <SeverityBadge severity={item.severity} />
                </td>
                <td>
                  <a href={routeHref({ page: "r-incident", id: item.id })}>
                    {getCategory(item.categoryId)?.label ?? item.categoryId}
                  </a>
                </td>
                <td>
                  {item.state === "held" ? (
                    <span className="tag">Not yet checked</span>
                  ) : (
                    item.label
                  )}
                </td>
                <td>{item.reportCount}</td>
                <td>{timeAgo(item.lastReportAt, now)}</td>
                <td className="muted">
                  {item.latestUpdate
                    ? `${item.latestUpdate.text} (${item.latestUpdate.organisation})`
                    : "None yet"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
