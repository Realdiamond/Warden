import {
  DEPLOYMENT_KINDS,
  type DeploymentKind,
  type DeploymentVisibility,
  type ResponderDeployment,
} from "@warden/shared";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { api } from "../api.ts";
import { timeAgo } from "../format.ts";
import type { Point } from "./PointPicker.tsx";

const PointPicker = lazy(() => import("./PointPicker.tsx"));

const KIND_LABEL: Record<DeploymentKind, string> = {
  patrol: "Patrol",
  checkpoint: "Checkpoint",
  ambulance: "Ambulance",
  fire_unit: "Fire unit",
  rescue: "Rescue team",
  other: "Other",
};

const VISIBILITY_LABEL: Record<DeploymentVisibility, string> = {
  public_street: "Public, street level (about 300 m)",
  public_area: "Public, general area (about 2 km)",
  responders: "Other responders only",
  hidden: "Only my organisation",
};

const DURATIONS = [60, 120, 240, 480, 720, 1440];

export function DeploymentsPage() {
  const [items, setItems] = useState<ResponderDeployment[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<DeploymentKind>("patrol");
  const [visibility, setVisibility] = useState<DeploymentVisibility>("public_area");
  const [duration, setDuration] = useState(240);
  const [point, setPoint] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems((await api.responder.deployments()).items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load deployments.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!point || !label.trim()) return;
    setBusy(true);
    try {
      await api.responder.deploy({
        label: label.trim(),
        kind,
        visibility,
        location: point,
        durationMinutes: duration,
      });
      setLabel("");
      setPoint(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the deployment.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Deployments</h1>
      <p className="muted">
        Public deployments appear on the Warden map as an area, never as an exact point.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <form
        className="card form-grid"
        onSubmit={(event) => {
          event.preventDefault();
          void create();
        }}
      >
        <label>
          Name
          <input
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Ikeja patrol 2"
          />
        </label>
        <label>
          Type
          <select value={kind} onChange={(e) => setKind(e.target.value as DeploymentKind)}>
            {DEPLOYMENT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Who can see it
          <select
            value={visibility}
            onChange={(e) => setVisibility(e.target.value as DeploymentVisibility)}
          >
            {Object.entries(VISIBILITY_LABEL).map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
        <label>
          For
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))}>
            {DURATIONS.map((minutes) => (
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
        <button type="submit" className="primary" disabled={busy || !point || !label.trim()}>
          Add deployment
        </button>
      </form>

      {items && items.length === 0 && <p className="page-message">No active deployments.</p>}
      {items && items.length > 0 && (
        <table className="queue">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Organisation</th>
              <th scope="col">Visible to</th>
              <th scope="col">Ends</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.label} <span className="muted">({KIND_LABEL[item.kind]})</span>
                </td>
                <td>{item.organisation}</td>
                <td>{VISIBILITY_LABEL[item.visibility]}</td>
                <td>
                  {new Date(item.endsAt).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </td>
                <td>
                  {item.mine && (
                    <button
                      type="button"
                      onClick={() => void api.responder.endDeployment(item.id).then(load)}
                    >
                      End now
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {items && <p className="muted">Updated {timeAgo(new Date().toISOString())}.</p>}
    </section>
  );
}
