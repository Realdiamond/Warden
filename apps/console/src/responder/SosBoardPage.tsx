import type { SosBoardItem } from "@warden/shared";
import { useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { formatCoordinate, timeAgo } from "../format.ts";

const REFRESH_MS = 20_000;

export function SosBoardPage() {
  const [items, setItems] = useState<SosBoardItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setItems((await api.responder.sos()).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the SOS board.");
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
      <h1>SOS in your area</h1>
      <p className="restricted" role="note">
        People chose to share these SOS alerts with responders. Exact locations are for responding
        only; every view is recorded in the audit log.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {items === null && !error && <p className="page-message">Loading…</p>}
      {items?.length === 0 && <p className="page-message">No active SOS in your area.</p>}
      {items?.map((item) => (
        <div key={item.sessionId} className={`card sos-card${item.duress ? " duress" : ""}`}>
          <h2>
            {item.personName}
            {item.duress && <span className="tag">May be under duress</span>}
          </h2>
          <p className="muted">SOS started {timeAgo(item.startedAt, now)}</p>
          {item.lastPoint ? (
            <p>
              <span className="mono">
                {formatCoordinate(item.lastPoint.lat)}, {formatCoordinate(item.lastPoint.lng)}
              </span>{" "}
              {item.lastPoint.accuracyM !== null && `±${Math.round(item.lastPoint.accuracyM)} m `}·
              updated {timeAgo(item.lastPoint.at, now)} ·{" "}
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${item.lastPoint.lat},${item.lastPoint.lng}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Open in maps
              </a>
            </p>
          ) : (
            <p className="muted">No location received yet.</p>
          )}
        </div>
      ))}
    </section>
  );
}
