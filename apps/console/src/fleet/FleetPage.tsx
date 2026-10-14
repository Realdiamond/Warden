// Fleet dashboard (M9) for transport and logistics companies: the places they watch, what the
// public map shows around each one in the last 24 hours, the 3-month outlook, and a route check.
// Fleets see only public, area-level information, the same as anyone using the app.

import {
  describeOutlook,
  type FleetOverview,
  type FleetZone,
  getCategory,
  type RouteCheckResult,
} from "@warden/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { SeverityBadge } from "../components/Badges.tsx";
import { timeAgo } from "../format.ts";
import type { Point } from "../responder/PointPicker.tsx";

const PointPicker = lazy(() => import("../responder/PointPicker.tsx"));
const RADII = [1_000, 2_000, 5_000, 10_000, 20_000];
const REFRESH_MS = 60_000;
const ROUTE_LEVEL = {
  calm: "Route looks calm",
  caution: "Take care on this route",
  avoid: "Think about another route or time",
} as const;

function Overview({
  overview,
  onRemove,
}: {
  overview: FleetOverview;
  onRemove: (zone: FleetZone) => void;
}) {
  if (overview.zones.length === 0) {
    return <p className="page-message">Add the depots, yards and stops your drivers use.</p>;
  }
  return (
    <div className="fleet-zones">
      {overview.zones.map(({ zone, incidents, bySeverity, outlook }) => (
        <section key={zone.id} className="card" aria-label={zone.name}>
          <header className="fleet-zone-head">
            <h3>{zone.name}</h3>
            <span className="muted">{zone.radiusM / 1000} km around</span>
            <button type="button" className="link-button" onClick={() => onRemove(zone)}>
              Remove
            </button>
          </header>
          <p>
            {incidents.length === 0
              ? "Nothing reported nearby in the last 24 hours."
              : `${incidents.length} incident${incidents.length === 1 ? "" : "s"} nearby in the last 24 hours` +
                ` (${bySeverity.critical} critical, ${bySeverity.high} high).`}
          </p>
          {incidents.length > 0 && (
            <ul className="fleet-incidents">
              {incidents.slice(0, 8).map((incident) => (
                <li key={incident.id}>
                  <SeverityBadge severity={incident.severity} />{" "}
                  {getCategory(incident.categoryId)?.publicLabel ??
                    getCategory(incident.categoryId)?.label ??
                    incident.categoryId}{" "}
                  <span className="muted">
                    · {incident.label} · {timeAgo(incident.lastReportAt)}
                    {incident.active ? "" : " · over"}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="muted">
            {outlook
              ? `Last 3 months: ${describeOutlook(outlook)}`
              : "Last 3 months: too few reports here for an outlook."}
          </p>
        </section>
      ))}
    </div>
  );
}

function RouteCheck() {
  const [from, setFrom] = useState<Point | null>(null);
  const [to, setTo] = useState<Point | null>(null);
  const [result, setResult] = useState<RouteCheckResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function check() {
    if (!from || !to) return;
    setError(null);
    try {
      setResult(await api.fleet.routeCheck(from, to));
    } catch (err) {
      setError(err instanceof Error ? err.message : "The route check failed.");
    }
  }

  return (
    <section>
      <h2>Check a route</h2>
      <p className="muted">
        Scores public incidents of the last 7 days within 1 km of the straight line between two
        points. It is a rough guide, not a road-by-road plan.
      </p>
      <div className="form-grid card">
        <div>
          <p>Start</p>
          <Suspense fallback={<p className="muted">Loading map…</p>}>
            <PointPicker value={from} onChange={setFrom} />
          </Suspense>
        </div>
        <div>
          <p>End</p>
          <Suspense fallback={<p className="muted">Loading map…</p>}>
            <PointPicker value={to} onChange={setTo} />
          </Suspense>
        </div>
        <button
          type="button"
          className="primary"
          disabled={!from || !to}
          onClick={() => void check()}
        >
          Check route
        </button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {result && (
        <div className="card" aria-live="polite">
          {result.tooLong ? (
            <p>This journey is too long to check in one go. Check it in shorter legs.</p>
          ) : (
            <>
              <p className={`route-${result.level}`}>
                <strong>{ROUTE_LEVEL[result.level]}</strong> (score {result.score} of 100)
              </p>
              {result.nearby.length > 0 && (
                <ul className="fleet-incidents">
                  {result.nearby.slice(0, 8).map((incident) => (
                    <li key={incident.id}>
                      <SeverityBadge severity={incident.severity} />{" "}
                      {getCategory(incident.categoryId)?.label ?? incident.categoryId}{" "}
                      <span className="muted">
                        · {Math.round(incident.distanceM / 100) / 10} km from the line ·{" "}
                        {timeAgo(incident.lastReportAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function FleetPage() {
  const [overview, setOverview] = useState<FleetOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [radius, setRadius] = useState(2_000);
  const [point, setPoint] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setOverview(await api.fleet.overview());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your places.");
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function add() {
    if (!point) return;
    setBusy(true);
    try {
      await api.fleet.addZone({ name: name.trim(), center: point, radiusM: radius });
      setName("");
      setPoint(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The place was not added.");
    } finally {
      setBusy(false);
    }
  }

  async function remove(zone: FleetZone) {
    if (!window.confirm(`Stop watching ${zone.name}?`)) return;
    try {
      await api.fleet.removeZone(zone.id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The place was not removed.");
    }
  }

  return (
    <section>
      <h1>Your places</h1>
      <p className="muted">
        What Warden's public map shows around each place, updated every minute. Areas are a few
        hundred metres to a few kilometres across; Warden never shares exact locations or who
        reported.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {overview === null && !error && <p className="page-message">Loading…</p>}
      {overview && <Overview overview={overview} onRemove={(zone) => void remove(zone)} />}

      <h2>Watch a new place</h2>
      <form
        className="card form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <label>
          Name
          <input
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            placeholder="Apapa depot"
          />
        </label>
        <label>
          Area
          <select value={radius} onChange={(e) => setRadius(Number(e.target.value))}>
            {RADII.map((m) => (
              <option key={m} value={m}>
                {m / 1000} km around the point
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
          className="primary"
          disabled={busy || !point || name.trim().length < 2}
        >
          Add place
        </button>
      </form>

      <RouteCheck />
    </section>
  );
}
