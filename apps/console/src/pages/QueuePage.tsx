import { getCategory, type IncidentState, type QueueItem } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { SeverityBadge } from "../components/Badges.tsx";
import { reviewDue, STATE_LABEL, timeAgo } from "../format.ts";
import { routeHref } from "../router.ts";

const TABS: IncidentState[] = [
  "held",
  "unconfirmed",
  "verified",
  "disputed",
  "resolved",
  "removed",
];
const REFRESH_MS = 15_000;

export function QueuePage({ state }: { state: IncidentState }) {
  const [items, setItems] = useState<QueueItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      const result = await api.queue(state);
      setItems(result.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the queue.");
    }
    setNow(Date.now());
  }, [state]);

  useEffect(() => {
    setItems(null);
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <section>
      <nav className="tabs" aria-label="Incident states">
        {TABS.map((tab) => (
          <a
            key={tab}
            href={routeHref({ page: "queue", state: tab })}
            className={tab === state ? "tab active" : "tab"}
            aria-current={tab === state ? "page" : undefined}
          >
            {STATE_LABEL[tab]}
          </a>
        ))}
      </nav>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && <p className="page-message">Loading…</p>}
      {items?.length === 0 && (
        <p className="page-message">
          Nothing here. {state === "held" ? "The review queue is clear." : ""}
        </p>
      )}

      {items && items.length > 0 && (
        <table className="queue">
          <thead>
            <tr>
              <th scope="col">Severity</th>
              <th scope="col">What</th>
              <th scope="col">Reports</th>
              <th scope="col">First reported</th>
              {state === "held" && <th scope="col">Review</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const category = getCategory(item.categoryId);
              const overdue = item.reviewDueInMs < 0;
              return (
                <tr key={item.id}>
                  <td>
                    <SeverityBadge severity={item.severity} />
                  </td>
                  <td>
                    <a href={routeHref({ page: "incident", id: item.id })}>
                      {category?.label ?? item.categoryId}
                    </a>
                    {category?.handling === "private" && <span className="tag">Private</span>}
                  </td>
                  <td>
                    {item.reportCount}
                    {item.independentReports !== item.reportCount && (
                      <span className="muted"> ({item.independentReports} phones)</span>
                    )}
                  </td>
                  <td>{timeAgo(item.firstReportedAt, now)}</td>
                  {state === "held" && (
                    <td className={overdue ? "overdue" : undefined}>
                      {reviewDue(item.reviewDueInMs)}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
