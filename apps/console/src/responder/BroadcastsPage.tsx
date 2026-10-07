import { type BroadcastSummary, MAX_BROADCAST_MESSAGE } from "@warden/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { timeAgo } from "../format.ts";
import type { Point } from "./PointPicker.tsx";

const PointPicker = lazy(() => import("./PointPicker.tsx"));

type Tier = "critical" | "warning" | "advisory";
const TIER_LABEL: Record<Tier, string> = {
  critical: "Danger (loud, breaks quiet hours)",
  warning: "Warning",
  advisory: "Advisory",
};
const RADII = [1_000, 3_000, 5_000, 10_000, 20_000, 50_000];
const EXPIRY = [60, 180, 360, 720, 1440];

export function BroadcastsPage() {
  const [items, setItems] = useState<BroadcastSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [tier, setTier] = useState<Tier>("warning");
  const [radius, setRadius] = useState(5_000);
  const [expiry, setExpiry] = useState(180);
  const [point, setPoint] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.responder.broadcasts()).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load broadcasts.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    if (!point) return;
    const km = radius / 1000;
    if (!window.confirm(`Send this ${tier} broadcast to everyone within ${km} km?`)) return;
    setBusy(true);
    try {
      await api.responder.broadcast({
        tier,
        message: message.trim(),
        center: point,
        radiusM: radius,
        expiresInMinutes: expiry,
      });
      setMessage("");
      setSent("Sent. Phones with saved places in the area will show it within a few minutes.");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The broadcast failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Broadcasts</h1>
      <p className="muted">
        Broadcasts are signed by Warden so phones can tell they are genuine. Keep them short and
        practical: what is happening, where, and what people should do.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {sent && <p className="card">{sent}</p>}
      <form
        className="card form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <label className="span-all">
          Message ({message.length}/{MAX_BROADCAST_MESSAGE})
          <textarea
            value={message}
            maxLength={MAX_BROADCAST_MESSAGE}
            rows={3}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Flooding on Third Mainland Bridge. Use Carter Bridge instead."
          />
        </label>
        <label>
          Level
          <select value={tier} onChange={(e) => setTier(e.target.value as Tier)}>
            {Object.entries(TIER_LABEL).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          Reach
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {RADII.map((m) => (
              <option key={m} value={m}>
                {m / 1000} km around the point
              </option>
            ))}
          </select>
        </label>
        <label>
          Shown for
          <select value={expiry} onChange={(e) => setExpiry(Number(e.target.value))}>
            {EXPIRY.map((minutes) => (
              <option key={minutes} value={minutes}>
                {minutes / 60} hour{minutes === 60 ? "" : "s"}
              </option>
            ))}
          </select>
        </label>
        <div className="span-all">
          <Suspense fallback={<p className="muted">Loading map…</p>}>
            <PointPicker value={point} onChange={setPoint} />
          </Suspense>
        </div>
        <button
          type="submit"
          className="danger"
          disabled={busy || !point || message.trim().length < 10}
        >
          Send broadcast
        </button>
      </form>

      {items && items.length > 0 && (
        <table className="queue">
          <thead>
            <tr>
              <th scope="col">Message</th>
              <th scope="col">Level</th>
              <th scope="col">Sent</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const live = !item.withdrawn && new Date(item.expiresAt).getTime() > Date.now();
              return (
                <tr key={item.id}>
                  <td>{item.message}</td>
                  <td>{item.tier}</td>
                  <td>{timeAgo(item.createdAt)}</td>
                  <td>
                    {live ? (
                      <button
                        type="button"
                        onClick={() => void api.responder.withdraw(item.id).then(load)}
                      >
                        Withdraw
                      </button>
                    ) : (
                      <span className="muted">{item.withdrawn ? "Withdrawn" : "Expired"}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
